/*global define module exports require */

function loadCss(url) {
    var link = document.createElement("link");
    link.type = "text/css";
    link.rel = "stylesheet";
    link.href = url;
    document.getElementsByTagName("head")[0].appendChild(link);
}

(function(root, factory) {    
    if (typeof define === 'function' && define.amd) {
	// AMD. Register as an anonymous module.
	define(['jquery','shpjs', 'interact','colorbrewer','d3',
		'jsep','leafletdraw','canvaslayer'], factory);
    } else if (typeof exports === 'object') {
	// Node. Does not work with strict CommonJS, but
	// only CommonJS-like environments that support module.exports,
	// like Node.
	module.exports = factory(require('jquery'),
				 require('shpjs'),
				 require('interact'),
				 require('colorbrewer'),
				 require('d3'),
				 require('jsep'),
				 require('leaflet'),
				 require('leafletdraw'),
				 require('canvaslayer'));
    } else {
	// Browser globals (root is window)
	root.Nanocube3 = factory(root.$,root.shp,root.interact,root.colorbrewer,
			root.d3,root.jsep,root.L);
    }
} (this, function($,shp,interact,colorbrewer,d3,jsep,L) {
    loadCss('node_modules/leaflet/dist/leaflet.css');
    loadCss('node_modules/leaflet-draw/dist/leaflet.draw.css');

    var Nanocube3 = {};

/*global $ jsep  */

var Expression = function(expr){
    this.parsetree = jsep(expr);
};

Expression.prototype = {
    getData: function(q,qfunc){
        return this._process(this.parsetree,q,qfunc);
    },

    _process: function(expr,q,qfunc){
        var p;
        switch(expr.type) {
        case 'CallExpression':
            p =  this._binExp(expr,q,qfunc);
            break;
        case 'BinaryExpression':
            p =  this._binExp(expr,q,qfunc);
            break;
        case 'LogicalExpression':
            p =  this._binExp(expr,q,qfunc);
            break;
        case 'MemberExpression':
            p = this._memExp(expr,q,qfunc);
            break;
        case 'Literal':
            var dfd = new $.Deferred();
            p = dfd.promise();
            dfd.resolve(expr.value);
            break;
        case 'Identifier':
            p = qfunc(q[expr.name]);
            break;
        default:
            throw "Cannot parse expression";
        }
        return p;
    },

    _memExp: function(memexp, q, qfunc){

        //function for recursive processing
        function memExpQuery(memexp, q){
            //process the type
            var newq = null ;
            if (memexp.object.type == 'MemberExpression'){
                newq = memExpQuery(memexp.object, q);
            }
            else if (memexp.object.type == 'Identifier'){
                //select the base query
                newq = $.extend(true,{}, q[memexp.object.name]);
            }

            //process the properties
            var prop = memexp.property;
            if (prop.type=='BinaryExpression'&& prop.operator==  '==' ){
                var catvar = prop.left.name;
                var catval;

                if(prop.right.type == 'Identifier'){
                    catval = [prop.right.name];
                }

                if(prop.right.type == 'Literal'){
                    catval = [prop.right.value];
                }

                if(prop.right.type == 'ArrayExpression'){
                    catval = prop.right.elements.map(function(d){
                        if (d.name){
                            return d.name;
                        }
                        else{
                            return d.value;
                        }
                    });
                }
                
                catval = catval.map(function(d){ return {cat: d , id: null };});
                
                newq.setCatConst(catvar,catval);
            }
            return newq;
        }

        //process the query
        var resq = memExpQuery(memexp,q);

        //exec the spatial query
        return qfunc(resq);
    },

    _binExp: function(binexp, q, qfunc){
        var dfd = new $.Deferred();

        //process left and right
        var left = this._process(binexp.left,q,qfunc);
        var right = this._process(binexp.right,q,qfunc);

        var expr = this;
        $.when(left,right).done(function(){
            var results = arguments;
            var resleft = results[0];
            var resright = results[1];

            function getOpFunc(operator){
                switch (operator){
                case '+':
                    return function(a,b) {return a+b;};
                case '-':
                    return function(a,b) {return a-b;};
                case '*':
                    return function(a,b) {return a*b;};
                case '/':
                    return function(a,b) {
                        if(isNaN(a/b)){
                            return 0;
                        }
                        else{
                            return a/b;
                        }
                    };
                case '||':
                    return function(a,b) { return Math.max(a,b); };
                case '&&':
                    return function(a,b) { return Math.min(a,b); };

                default:
                    throw "Unsupported Operation";
                }
            }

            var opfunc = getOpFunc(binexp.operator);
            if (!opfunc){
                dfd.resolve(null);
            }

            var res = null;
            if (opfunc){
                res = expr._op(opfunc,resleft,resright);
            }
            dfd.resolve(res);
        });
        return dfd.promise();
    },

    _callExp: function(callexp, q, qfunc){
        var dfd = new $.Deferred();

        //process the arguments
        var args = callexp.arguments.forEach(function(d){
            return this._process(d,q,qfunc);
        });

        var expr = this;
        $.when.apply($,args).done(function(){
            var results = arguments;

            function getOpFunc(operator){
                switch (operator){
                case '+':
                    return function(a,b) {return a+b;};
                case '-':
                    return function(a,b) {return a-b;};
                case '*':
                    return function(a,b) {return a*b;};
                case '/':
                    return function(a,b) {return (a+1e-4)/(b+1e-4);};
                default:
                    throw "Unsupported Operation";
                }
            }

            var opfunc = getOpFunc(binexp.operator);
            if (!opfunc){
                dfd.resolve(null);
            }

            var res = null;
            if (opfunc){
                res = expr._op(opfunc,resleft,resright);
            }
            dfd.resolve(res);
        });
        return dfd.promise();
    },

    _opTemporal: function(opfunc,left,right){
        var lefthash = {};
        if (typeof left === 'number'){
            right.data.forEach(function(d,i){
                lefthash[d.time] = left;
            });
        }
        else{
            left.data.forEach(function(d,i){
                lefthash[d.time] = d.val;
            });
        }
       var righthash = {};
        if (typeof right == 'number'){
            left.data.forEach(function(d,i){
                righthash[d.time] = right;
            });
        }
        else{
            right.data.forEach(function(d,i){
                righthash[d.time] = d.val;
            });
        }


        var allkeys = {};
        Object.keys(righthash).forEach(function(d){ allkeys[d]=1; });
        Object.keys(lefthash).forEach(function(d){ allkeys[d]=1; });


        var res = {};
        res.data = Object.keys(allkeys).map(function(k){
            var l = lefthash[k] || 0 ;
            var r = righthash[k] || 0;
            var val =  opfunc(l,r);

            return {time: new Date(k),val: val};
        });
        res.data = res.data.filter(function(d){return isFinite(d.val);});
        res.data = res.data.filter(function(d){return d.val !== 0;});
        res.type = left.type || right.type;
        //res.data = res.data.sort(function(a,b){return a.time - b.time;});

        return res;
    },

    _opCategorical: function(opfunc,left,right){
        if (typeof left === 'number'){
            var leftval = left;
            left = $.extend(true, {}, right);
            left.data = left.data.map(function(d) {
                d.val = leftval;
                return d;
            });
        }
        
        if (typeof right == 'number'){
            var rightval = right;
            right = $.extend(true, {}, left);
            right.data = right.data.map(function(d) {
                d.val = rightval;
                return d;
            });

        }
        var lefthash = {};
        left.data.forEach(function(d) {
            lefthash[d.id]=d.val;
        });
        var righthash = {};
        right.data.forEach(function(d) {
            righthash[d.id]=d.val;
        });
        
        var allkeys = {};
        left.data.forEach(function(d){
            allkeys[d.id] = d.cat;
        });

        right.data.forEach(function(d){
            allkeys[d.id] = d.cat;
        });

        var res = {};
        res.data = Object.keys(allkeys).map(function(k){
            var l = lefthash[k] || 0 ;
            var r = righthash[k] || 0;
            var val = opfunc(l,r);

            return {id:k, cat:allkeys[k],val:val};
        });
        res.data = res.data.filter(function(d){return isFinite(d.val);});
        res.data = res.data.filter(function(d){return d.val !== 0;});
        res.type = left.type || right.type;
        return res;
    },

    _opSpatial: function(opfunc,left,right){
        var lefthash = {};
        if (typeof left === 'number'){
            right.data.forEach(function(d,i){
                lefthash[[d.x,d.y]] = left;
            });
        }
        else{
            left.data.forEach(function(d,i){
                lefthash[[d.x,d.y]] = d.val;
            });
        }

        var righthash = {};
        if (typeof right == 'number'){
            left.data.forEach(function(d,i){
                righthash[[d.x,d.y]] = right;
            });
        }
        else{
            right.data.forEach(function(d,i){
                righthash[[d.x,d.y]] = d.val;
            });
        }


        var allkeys = {};
        Object.keys(righthash).forEach(function(d){ allkeys[d]=1; });
        Object.keys(lefthash).forEach(function(d){ allkeys[d]=1; });



        var res = {opts: left.opts || right.opts};
        res.data = Object.keys(allkeys).map(function(k){
            var l = lefthash[k] || 0 ;
            var r = righthash[k] || 0;
            var val =  opfunc(l,r);

            var coord = k.split(',');
            return {x: +coord[0],y: +coord[1],val: val};
        });
        res.data = res.data.filter(function(d){return isFinite(d.val);});
        res.data = res.data.filter(function(d){return d.val !== 0;});
        res.type = left.type || right.type;
        return res;
    },

    _op: function(opfunc,left,right){
        var type = left.type || right.type;

        switch(type){
        case 'spatial':
            return this._opSpatial(opfunc,left,right);
        case 'temporal':
            return this._opTemporal(opfunc,left,right);
        case 'cat':
            return this._opCategorical(opfunc,left,right);

        default:
            return null;
        }
    }
};

/*global d3 $ */

function GroupedBarChart(opts, getDataCallback, updateCallback, getXYCallback){
    this.getDataCallback=getDataCallback;
    this.updateCallback=updateCallback;
    this.getXYCallback = getXYCallback;

    var name=opts.name;
    this._name = name;
    var id = "#"+name.replace(/\./g,'\\.');
    var margin = {top: 20, right: 20, bottom: 30, left: 40};

    this.id = id;
    this.margin = margin;

    //set param
    this.selection = {global:[]};
    this.tempselection = {};

    this.retbrush = {
        color:'',
        x:'',
        y:''
    };

    this.retx = ['default'];
    this.rety = ['default'];
    
    var widget = this;
    //Make draggable and resizable
    d3.select(id).attr("class","barchart resize-drag");
    
    d3.select(id).on("divresize",function(){
        widget.update();
    });

    this.toplayer = d3.select(id).append("div")
        .style("width", $(id).width() + "px")
        .style("height", 40 + "px")
        .attr("class", "toplayer");

    this.botlayer = d3.select(id).append("div")
        .style("width", $(id).width() + "px")
        .style("height", $(id).height() + "px");

    //Add clear button
    this.clearbtn = this.toplayer
        .append('button')
        .attr('class','clear-btn')
        .on('click',function(){
            d3.event.stopPropagation();
            
            delete widget.selection.brush; //clear selection
            widget.update(); //redraw itself
            widget.updateCallback(widget._encodeArgs());            
        }).html('clear');
    
    //Add sort button
    this.sortbtn = this.toplayer
        .append('button')
        .attr('class','sort-btn')
        .on('click',function(){
            d3.event.stopPropagation();
            widget._opts.alpha_order = !widget._opts.alpha_order;
            widget.redraw(widget.lastres);
        });

    this.cmpbtn = this.toplayer
        .append('button')
        .attr('class','cmp-btn')
        .on('click',function(){
            widget.runCompare();
        }).html('Compare');

    this.finbtn = this.toplayer
        .append('button')
        .attr('id',(name + 'fin'))
        .on('click',function(){
            Object.keys(widget.tempselection).map(function(k){
                widget.selection[k] = widget.tempselection[k];
                delete widget.tempselection[k];
            });
            widget.compare = true;
            widget.adjust = false;
            widget.cmpbtn.html("Reset");
            delete widget.selection.brush;
            $('#' + name + 'fin').hide();
            widget.update();
            widget.updateCallback(widget._encodeArgs(), [], widget.compare);
        }).html('Compare!');

    $('#' + name + 'fin').hide();

    this.toplayer.append("text")
        .attr("x", $(id).width() / 2)
        .attr("y", 16)
        .attr("font-family", "sans-serif")
        .attr("font-size", "16px")
        .attr("text-anchor", "center")
        .attr("fill", "#fff")
        .text(opts.name);
    
    //Collapse on dbl click
    d3.select(id).on('dblclick',function(d){
        var currentheight = d3.select(id).style("height");
        if ( currentheight != "40px"){
            widget.restoreHeight =currentheight ;
            d3.select(id).style('height','40px');
        }
        else{
            d3.select(id).style("height",widget.restoreHeight);
        }
    });

    
    //SVG container
    var svg = {};
    var y0 = {};
    var y1 = {};
    var yAxis = {};
    this.margin.left = {};
    for(var j in this.rety){
        svg[this.rety[j]] = {};
        y0[this.rety[j]] = {};
        y1[this.rety[j]] = {};
        yAxis[this.rety[j]] = {};
        this.margin.left[this.rety[j]] = {};
        for(var i in this.retx){
            svg[this.rety[j]][this.retx[i]] = this.botlayer
                .append("svg")
                .attr("class", "barsvg")
                .append("g");
            //Title
            svg[this.rety[j]][this.retx[i]].append('text')
                .attr('y',-8)
                .attr("font-size", "10px")
                .attr('text-anchor', 'middle')
                .attr('fill', '#fff')
                .attr("class", "total");
            svg[this.rety[j]][this.retx[i]].append('text')
                .attr('y',-2)
                .attr('x', -5)
                .attr('text-anchor', 'end')
                .attr("font-size", "10px")
                .attr("class", "xtext")
                .text("X COLOR");
            svg[this.rety[j]][this.retx[i]].append('text')
                .attr('y',-2)
                .attr('x', 5)
                .attr('text-anchor', 'start')
                .attr("font-size", "10px")
                .attr("class", "ytext")
                .text("Y COLOR");
            
            //Axes
            svg[this.rety[j]][this.retx[i]].append("g").attr("class", "y axis")
                .attr("transform", "translate(-3,0)");
            svg[this.rety[j]][this.retx[i]].append("g").attr("class", "x axis");

            y0[this.rety[j]][this.retx[i]] = d3.scaleBand();
            y1[this.rety[j]][this.retx[i]] = d3.scaleBand();
            yAxis[this.rety[j]][this.retx[i]] = d3.axisLeft();
            this.margin.left[this.rety[j]][this.retx[i]] = 40;
        }
    }
    
    //Scales
    var x = d3.scaleLinear();
    if (opts.logaxis){
        x = d3.scaleLog();
    }

    //Axis
    var xAxis = d3.axisBottom()
        .ticks(3,opts.numformat);


    //set default values 
    opts.numformat = opts.numformat || ",";    
    if(!opts.hasOwnProperty('alpha_order')) {
        opts.alpha_order = true;
    }

    //Save vars to "this"
    
    this.svg=svg;
    this.y0=y0;
    this.y1=y1;
    this.x=x;
    this.xAxis = xAxis;
    this.yAxis = yAxis;
    this.compare = false;
    
    this._datasrc = opts.datasrc;
    this._opts = opts;
    this._logaxis = opts.logaxis;
    this._name = name;

    widget.update();
    if(opts.args){ // set selection from arguments
        this._decodeArgs(opts.args);
    }
    widget.update();

}

GroupedBarChart.brushcolors = colorbrewer.Set1[5].slice(0);
// GroupedBarChart.nextcolor = function(){
//     var c = GroupedBarChart.brushcolors.shift();
//     GroupedBarChart.brushcolors.push(c);
//     return c;
// };
function arraysEqual(arr1, arr2) {
    if(arr1.length !== arr2.length)
        return false;
    for(var i = arr1.length; i--;) {
        if(arr1[i] !== arr2[i])
            return false;
    }

    return true;
}

GroupedBarChart.prototype = {
    getSelection: function(){        
        return this.selection;
    },
    
    _encodeArgs: function(){
        var args = this.getSelection();
        var res = {};
        Object.keys(args).map(function(color){
            if(color.startsWith("#")){
                res[color.substr(1)] = JSON.parse(JSON.stringify(args[color]));
            }
            else{
                res[color] = JSON.parse(JSON.stringify(args[color]));
            }
        });
        return JSON.stringify(res);
    },
    
    _decodeArgs: function(s){
        var widget = this;
        var args = JSON.parse(s);
        var colors = Object.keys(args);

        var xydata = this.getXYCallback();
        widget.retx = xydata[0];
        widget.rety = xydata[1];

        var res = {};
        for(var col = 0; col < 5; col++){
            var curcolor = GroupedBarChart.brushcolors[col];
            if(colors.indexOf(curcolor.substr(1)) != -1){
                widget.compare = true;
                res[curcolor] = JSON.parse(JSON.stringify(args[curcolor.substr(1)]));
                delete args[curcolor.substr(1)];
            }
        }
        if(args.hasOwnProperty("brush"))
            res.brush = JSON.parse(JSON.stringify(args.brush));
        res.global = JSON.parse(JSON.stringify(args.global));
        this.selection = res;
        if(widget.compare){
            $('#' + this._name + 'fin').click();
        }

    },
    
    update: function(){
        var widget = this;
        var xydata = this.getXYCallback();
         if(!arraysEqual(this.retx,xydata[0]) || !arraysEqual(this.rety,xydata[1])){
            console.log("Rebuilding..");
            this.retx = xydata[0];
            this.rety = xydata[1];

            d3.select(this.id).selectAll(".barsvg").remove();

            var svg = {};
            var y0 = {};
            var y1 = {};
            var yAxis = {};
            this.margin.left = {};
            for(var j in this.rety){
                svg[this.rety[j]] = {};
                y0[this.rety[j]] = {};
                y1[this.rety[j]] = {};
                yAxis[this.rety[j]] = {};
                this.margin.left[this.rety[j]] = {};
                for(var i in this.retx){
                    svg[this.rety[j]][this.retx[i]] = this.botlayer
                        .append("svg")
                        .attr("class", "barsvg")
                        .append("g");
                    //Title
                    svg[this.rety[j]][this.retx[i]].append('text')
                        .attr('y',-8)
                        .attr("font-size", "10px")
                        .attr('text-anchor', 'middle')
                        .attr('fill', '#fff')
                        .attr("class", "total");
                    svg[this.rety[j]][this.retx[i]].append('text')
                        .attr('y',-2)
                        .attr('x', -5)
                        .attr('text-anchor', 'end')
                        .attr("font-size", "10px")
                        .attr("class", "xtext")
                        .text("X COLOR");
                    svg[this.rety[j]][this.retx[i]].append('text')
                        .attr('y',-2)
                        .attr('x', 5)
                        .attr('text-anchor', 'start')
                        .attr("font-size", "10px")
                        .attr("class", "ytext")
                        .text("Y COLOR");
                    
                    //Axes
                    svg[this.rety[j]][this.retx[i]].append("g").attr("class", "y axis")
                        .attr("transform", "translate(-3,0)");
                    svg[this.rety[j]][this.retx[i]].append("g").attr("class", "x axis");

                    y0[this.rety[j]][this.retx[i]] = d3.scaleBand();
                    y1[this.rety[j]][this.retx[i]] = d3.scaleBand();
                    yAxis[this.rety[j]][this.retx[i]] = d3.axisLeft();
                    this.margin.left[this.rety[j]][this.retx[i]] = 40;
                }
            }

            this.svg = svg;
            this.y0 = y0;
            this.y1 = y1;
            this.yAxis = yAxis;

        }
        var promises = {};
        
        //generate promise for each expr
        for (var d in widget._datasrc){
            if (widget._datasrc[d].disabled){
                continue;
            }
            var p = this.getDataCallback(d);
            for (var k in p){
                promises[k] = p[k];
            }
        }

        var promarray = Object.keys(promises).map(function(k){
            return promises[k];
        });
        
        var promkeys = Object.keys(promises);
        $.when.apply($,promarray).done(function(){
            var results = arguments;
            var res = {};
            Object.keys(widget.svg).map(function(a){
                res[a] = {};
                Object.keys(widget.svg[a]).map(function(b){
                    res[a][b] = {};
                    promkeys.forEach(function(d,i){
                        var label = d.split('&-&');
                        var xyc = label[0].split('&');
                        var ret = {};
                        xyc.map(function(k){
                            ret[k.charAt(0)] = k.substring(1);
                        });

                        //check ret.x, ret.y
                        if(ret.x != b && b != 'default')
                            return;
                        if(ret.y != a && a != 'default')
                            return;
                        if(ret.c)
                            res[a][b][ret.c] = results[i];
                        else
                            res[a][b]["global&-&" + label[1]] = results[i];
                    });
                });
            });
            
            widget.lastres = res;
            widget.redraw(res);
        });
    },
    
    flattenData: function(res){
        var widget = this;        
        return Object.keys(res).reduce(function(prev,curr){
            var c = curr;

            var isColor  = /^#[0-9A-F]{6}$/i.test(c);                
            if(!isColor){
                var label = curr.split('&-&');
                var colormap = widget._datasrc[label[1]].colormap;
                var cidx = Math.floor(colormap.length/2);
                c = colormap[cidx];
            }

            //Add color
            var row = res[curr].data.map(function(d){
                d.color = c;
                return d;
            });
            return prev.concat(row);
        }, []);
    },

    redraw :function(res){
        var widget = this;
        var topn = this._opts.topn;

        if(topn !== undefined ){
            Object.keys(res).map(function(i){
                Object.keys(res[i]).map(function(j){
                    var agg = {};
                    Object.keys(res[i][j]).forEach(function(k){
                        res[i][j][k].data.forEach(function(d){
                            agg[d.cat]= (agg[d.cat] + d.val) || d.val;
                        });
                    });
                    var kvlist =Object.keys(agg)
                        .map(function(d){return {cat: d, val:agg[d]};});
                    kvlist.sort(function(x,y) { return y.val - x.val; });
                    kvlist = kvlist.slice(0,topn);
                    var kvhash = {};
                    kvlist.forEach(function(d){ kvhash[d.cat] = d.val; });
                    Object.keys(res[i][j]).forEach(function(k){
                        res[i][j][k].data = res[i][j][k].data.filter(function(d){
                            return (d.cat in kvhash);
                        });
                    });
                    // console.log(res[i][j]);
                });
            });
        }
        var fdata = {};
        Object.keys(res).map(function(i){
            fdata[i] = {};
            Object.keys(res[i]).map(function(j){
                fdata[i][j] = widget.flattenData(res[i][j]);
            });
        });

        var x =this.x;
        var y0 =this.y0;
        var y1 =this.y1;
        var svg =this.svg;
        var selection = this.selection;
        
        
        //update the axis and svgframe
        this.updateYAxis(fdata);
        this.updateXAxis(fdata);
        this.updateSVG();


        Object.keys(fdata).map(function(i){
            Object.keys(fdata[i]).map(function(j){


                //bind data
                var bars = widget.svg[i][j].selectAll('.bar').data(fdata[i][j]);

                // if(bars._groups[0].length === 0)
                //     return;

                //append new bars
                bars.enter()
                    .append('rect')
                    .attr('class', 'bar')
                    .on('click', function(d) { widget.clickFunc(d);})//toggle callback
                    .append("svg:title"); //tooltip

                bars = widget.svg[i][j].selectAll('.bar').data(fdata[i][j]);

                //set shape
                bars.attr('x', 0)
                    .attr('y', function(d){return widget.y0[i][j](d.cat) + //category
                                           widget.y1[i][j](d.color);}) //selection group
                    .style('fill', function(d){
                        if (!widget.selection.brush || //no selection
                            widget.selection.brush.findIndex(function(b){
                                return (b.cat == d.cat); }) != -1){//in selection
                            return d.color;
                        }
                        else{
                            return 'gray';
                        }
                    })
                    .attr('height',function(d){
                        return widget.y1[i][j].bandwidth()-1;
                    })
                    .attr('width',function(d){
                        var w = widget.x(d.val);
                        if(isNaN(w) && d.val <=0 ){
                            w = 0;
                        }
                        return w;
                    });

                if(widget.compare){
                    Object.keys(widget.selection).filter(function(n){
                        return (n != 'brush') && (n != 'global');
                    }).forEach(function(s){
                        var cats = Object.keys(widget.selection[s]).map(function(k){
                            return widget.selection[s][k].cat;
                        });
                        svg[i][j].select('.y.axis')
                            .selectAll("text")
                            .filter(function(n){
                                return (cats.indexOf(n) != -1);
                            })
                            .style("fill", s);
                    });

                    
                    // bars.style('fill', function(d){
                    //     var col;
                    //     Object.keys(widget.selection).filter(function(n){
                    //         return (n != 'brush') && (n != 'global');
                    //     }).forEach(function(s){
                    //         if(widget.selection[s] == [] || 
                    //            widget.selection[s].findIndex(function(b){
                    //                 return (b.cat == d.cat);}) != -1){
                    //             col = s;
                    //         }
                            
                    //     });

                    //     return col || 'gray';
                    // });
                }
                
                //add tool tip
                bars.select('title').text(function(d){
                    return d3.format(widget._opts.numformat)(d.val);
                });

                //remove bars with no data
                bars.exit().remove();
            });
        });
    },

    clickFunc:function(d){
        var widget = this;
        if(!widget.selection.brush){
            widget.selection.brush = [];
        }
            
        var idx = widget.selection.brush.findIndex(function(b){
            return (b.cat == d.cat);
        });
        
        if (idx != -1){
            widget.selection.brush.splice(idx,1);
        }
        else{
            if(d3.event.shiftKey){
                widget.selection.brush.push({id:d.id, cat:d.cat});
            }
            else{
                widget.selection.brush = [{id:d.id, cat:d.cat}];
            }                        
        }
        
        if(widget.selection.brush.length < 1){
            delete widget.selection.brush;
        }            
            
        widget.update(); //redraw itself
        widget.updateCallback(widget._encodeArgs());            
    },

    updateSVG : function(){
        var svg = this.svg;
        var margin = this.margin;
        var widget = this;
        var height = this.totalheight;
        var width = this.width;

        this.toplayer.style("width", $(this.id).width() + "px");
        this.botlayer.style("width", $(this.id).width() + "px");

        Object.keys(svg).map(function(i){
            Object.keys(svg[i]).map(function(j){
                var svgframe = d3.select(svg[i][j].node().parentNode);
                //resize the frame
                svgframe.attr("width", width + widget.maxLeft + margin.right);
                svgframe.attr("height", height + margin.top + margin.bottom);
                svg[i][j].attr("transform", "translate("+widget.maxLeft+","+margin.top+")");
            });
        });
    },

    updateXAxis: function(data){
        var margin = this.margin;
        var x=this.x;
        var xAxis=this.xAxis;
        var svg=this.svg;
        var widget = this;



        var anysvg = this.getAny(svg);

        var width = $(this.id).width();
        // console.log(width);
        for(var i in this.retx)
            width -= (widget.maxLeft + widget.margin.right);

        width /= this.retx.length;
        width -= 5;
        // console.log(width);
        if(width < 0)
            width = 1;

        var dlistmin = [];
        var dlistmax = [];
        Object.keys(data).map(function(i){
            Object.keys(data[i]).map(function(j){
                dlistmin.push(d3.min(data[i][j], function(d) {return +d.val;}));
                dlistmax.push(d3.max(data[i][j], function(d) {return +d.val;}));
            });
        });

        var d = [Math.min.apply(null,dlistmin),
                 Math.max.apply(null,dlistmax)];

        if(this._opts.logaxis){ // prevent zeros for log
            d[0] = Math.max(d[0]-1e-6,1e-6);
        }
        else{
            d[0] = Math.min(d[0],d[1]-Math.abs(d[1]/2));
            d[0] = d[0]-0.1*Math.abs(d[0]);
        }
        
        //set domain from options
        if(this._opts.domain){
            if(this._opts.domain.min !== undefined){
                d[0] = this._opts.domain.min;
            }
                
            if(this._opts.domain.max !== undefined){
                d[1] = this._opts.domain.max;
            }
        }
        
        //set domain
        x.domain(d);        
        x.range([0,width]);
        
        xAxis.scale(x);

        //move and draw the axis
        Object.keys(svg).map(function(i){
            Object.keys(svg[i]).map(function(j){
                svg[i][j].select('.x.axis')
                    .attr("transform", "translate(0,"+widget.totalheight+")")
                    .call(xAxis);
            });
        });
        
        this.width=width;
    },

    updateYAxis:function(data){
        var y0=this.y0;
        var y1=this.y1;
        var yAxis=this.yAxis;
        var svg = this.svg;
        var opts = this._opts;
        var sortbtn = this.sortbtn;
        var widget = this;
        
        Object.keys(data).map(function(i){
            Object.keys(data[i]).map(function(j){
                //Sort y axis
                if (opts.alpha_order){            
                    y0[i][j].domain(data[i][j].map(function(d){return d.cat;}).sort());
                    if (y0[i][j].domain().every(function(d) {return !isNaN(d);})){
                        y0[i][j].domain(y0[i][j].domain().sort(function(a,b){return a-b;}));
                    }
                    sortbtn.html('#');
                }
                else{ //sort by data value
                    var d = data[i][j].sort(function(x,y){ return y.val - x.val;});
                    y0[i][j].domain(d.map(function(d){return d.cat;}));
                    sortbtn.html('A');
                }

                y1[i][j].domain(data[i][j].map(function(d){return d.color;}));
            });
        });


        var maxy0length = 0;
        var maxy1length = 0;

        Object.keys(y0).map(function(i){
            Object.keys(y0[i]).map(function(j){
                maxy0length = Math.max(maxy0length, y0[i][j].domain().length);
                maxy1length = Math.max(maxy1length, y1[i][j].domain().length);
            });
        });

        var totalheight = maxy0length * maxy1length * 18;

        Object.keys(y0).map(function(i){
            Object.keys(y0[i]).map(function(j){
                y0[i][j].rangeRound([0, totalheight]);
                y1[i][j].rangeRound([0, y0[i][j].bandwidth()]);
                yAxis[i][j].scale(y0[i][j]);

                svg[i][j].select('.y.axis').call(yAxis[i][j]);



                //enable axis click
                svg[i][j].select('.y.axis').selectAll('.tick')
                    .on('click',function(d){
                        var obj = data[i][j].filter(function(e){return e.cat==d;})[0];
                        widget.clickFunc(obj);
                    });

                widget.margin.left[i][j] = svg[i][j].select('.y.axis').node().getBBox().width+3;
                //update title with cat count
                svg[i][j].select('.total').text('('+y0[i][j].domain().length+')');
                var xtext = svg[i][j].select('.xtext');
                var ytext = svg[i][j].select('.ytext');


                if(j != 'default')
                    xtext.attr('fill', j);
                else
                    xtext.attr('fill', '#fff');

                if(i != 'default')
                    ytext.attr('fill', i);
                else
                    ytext.attr('fill', '#fff');

            });
        });

        widget.maxLeft = 0;
        Object.keys(widget.margin.left).map(function(i){
            Object.keys(widget.margin.left[i]).map(function(j){
                widget.maxLeft = Math.max(widget.maxLeft, widget.margin.left[i][j]);
            });
        });

        this.totalheight = totalheight;
    },

    runCompare: function(){
        var widget = this;
        d3.event.stopPropagation();
        if(widget.cmpbtn.html() == "Compare" && 
            (widget.retbrush.color == widget._name || 
             widget.retbrush.x == widget._name ||
             widget.retbrush.y == widget._name)){
            delete widget.selection.brush;
            widget.update();
            widget.cmpbtn.html("Selection 1");
            $('#' + widget._name + 'fin').show();
        }

        else if(widget.cmpbtn.html() == "Selection 5"){
            widget.tempselection[GroupedBarChart.brushcolors[4]] = widget.selection.brush || [];
            Object.keys(widget.tempselection).map(function(k){
                widget.selection[k] = widget.tempselection[k];
                delete widget.tempselection[k];
            });
            widget.compare = true;
            widget.adjust = false;
            widget.cmpbtn.html("Reset");
            $('#' + widget._name + 'fin').hide();
            delete widget.selection.brush;
            widget.update();
            widget.updateCallback(widget._encodeArgs(), [], widget.compare);

        }

        else if (widget.cmpbtn.html().startsWith("Selection")){
            var sel = parseInt(widget.cmpbtn.html().split(' ')[1]);
            widget.tempselection[GroupedBarChart.brushcolors[sel - 1]] = widget.selection.brush;
            if(widget.selection.brush === undefined)
                widget.tempselection[GroupedBarChart.brushcolors[sel - 1]] = [];
            widget.cmpbtn.html("Selection " + (sel + 1));
            delete widget.selection.brush;
            widget.update();
            widget.updateCallback(widget._encodeArgs());

        }
        else{
            //reset
            Object.keys(widget.svg).map(function(i){
                Object.keys(widget.svg[i]).map(function(j){
                    widget.svg[i][j].select('.y.axis').selectAll("text").style("fill", "#fff");
                });
            });
            
            GroupedBarChart.brushcolors.map(function(k){
                delete widget.selection[k];
            });
            widget.compare = false;
            widget.cmpbtn.html("Compare");
            widget.update();
            widget.updateCallback(widget._encodeArgs(), [], widget.compare);
        }
    },

    getAny: function(obj){
        var temp = obj[Object.keys(obj)[0]];
        return temp[Object.keys(temp)[0]];
    },
};

/*global $ L colorbrewer d3 window */

var Map=function(opts,getDataCallback,updateCallback, getXYCallback){
    this.getDataCallback = getDataCallback;
    this.updateCallback = updateCallback;
    this.getXYCallback = getXYCallback;

    this._datasrc = opts.datasrc;
    this._coarse_offset = opts.coarse_offset || 0;
    this._name = opts.name || 'defaultmap';

    this._tilesurl = opts.tilesurl ||
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

    this.retx = ['default'];
    this.rety = ['default'];
    this.retbrush = {
        color:'',
        x:'',
        y:''
    };
    this._layers = this._genLayers(this._datasrc);
    this._maxlevels = opts.levels || 25;
    this._logheatmap = true;
    this._opts = opts;
    this.compare = false;
    this.colorsUsed = [];
    this.colorNumber = {};
    this.newLayerColors = {};

    var colors = colorbrewer.Accent[8].slice(0);
    var yellow = colors.splice(3,1);
    colors.push(yellow);

    this.brushcolors = colors;
    
    var map = this._initMap();

    this._map = map;

    //add Legend
    if (opts.legend){
        this._addLegend(map);
    }

    
    //set according to url
    if(opts.args){
        this._decodeArgs(opts.args);
    }
    else{
        if ('viewbox' in opts){
            this.setSelection('global',opts.viewbox);
        }
        else if ('view' in opts){
            this.setSelection('global', opts.view);
        }
        else{
            this.setSelection('global', {c:{lat:0,lng:0},z:0});
        }
    }

    if('layers' in opts){
        if ('markers' in opts.layers){
            opts.layers.markers.forEach(function(d){
                var m = L.marker(d.coordinate);
                m.bindPopup(d.popup);
                m.addTo(map);
            });
        }                        
    }

    

};

//Setup static variables and functions
Map.brushcolors = colorbrewer.Accent[8].slice(0);
// console.log(Map.brushcolors);
Map.nextcolor = function(){
    var c = Map.brushcolors.shift();
    Map.brushcolors.push(c);
    return c;
};
Map.shp = shp;
Map.heatcolormaps = {
    "#e41a1c": colorbrewer.Reds[9].slice(0).reverse(),
    "#377eb8": colorbrewer.Blues[9].slice(0).reverse(),
    "#4daf4a": colorbrewer.Greens[9].slice(0).reverse(),
    "#984ea3": colorbrewer.Purples[9].slice(0).reverse(),
    "#ff7f00": colorbrewer.Oranges[9].slice(0).reverse(),

    "#7fc97f": colorbrewer.Greens[9].slice(0).reverse(),
    "#beaed4": colorbrewer.Purples[9].slice(0).reverse(),
    "#fdc086": colorbrewer.Oranges[9].slice(0).reverse(),
    "#ffff99": colorbrewer.YlOrRd[9].slice(0).reverse(),
    "#386cb0": colorbrewer.Blues[9].slice(0).reverse(),
    "#f0027f": colorbrewer.Reds[9].slice(0).reverse(),
    "#bf5b17": colorbrewer.YlOrBr[9].slice(0),
    "#666666": colorbrewer.Greys[9].slice(0).reverse()

};

function arraysEqual(arr1, arr2) {
    if(arr1.length !== arr2.length)
        return false;
    for(var i = arr1.length; i--;) {
        if(arr1[i] !== arr2[i])
            return false;
    }

    return true;
}

function hexToColor(color){
    var colors = {"#e41a1c":"Red", "#377eb8":"Blue","#4daf4a":"Green",
                  "#984ea3":"Purple","#ff7f00":"Orange", "#7fc97f":"Green", 
                  "#beaed4":"Purple", "#fdc086":"Orange", "#ffff99":"Yellow", 
                  "#386cb0":"Blue", "#f0027f":"Red", "#bf5b17":"Brown", 
                  "#666666":"Gray"};
    if(typeof colors[color] != 'undefined')
        return colors[color];
    return color;
}


Map.prototype = {
    colornext: function(){
        var c = this.brushcolors.shift();
        this.brushcolors.push(c);
        return c;
    },
    _genLayers: function(data){
        var widget = this;
        var layers = {};
        function drawfunc(layer,options){
                widget._canvasDraw(layer,options);
        }

        function colorfunc(d,i,array){
            var m = d.match(/rgba\((.+),(.+),(.+),(.+)\)/);
            if(m){
                    d={r:+m[1],g:+m[2],b:+m[3],a:+m[4]*255};
                return d;
            }
            else{
                d = d3.rgb(d);
                return {r:d.r, g:d.g, b:d.b, a:i/array.length*255};
            }
        }

        var hcmaps = {};
        Object.keys(Map.heatcolormaps).map(function(h){
            hcmaps[h] = Map.heatcolormaps[h].map(colorfunc);
        });
        // console.log(widget.retx,widget.rety);
        for (var d in data){
            for (var i in widget.retx){
                for(var j in widget.rety){
                    var layer = L.canvasOverlay(drawfunc,{opacity:0.7});

                    layer.zIndex = -100;
                    //set datasrc
                    layer._datasrc = d;

                    //set color
                    var midx = Math.floor(widget._datasrc[d].colormap.length /2);
                    layer._color = widget._datasrc[d].colormap[midx];
                    
                    //set colormap
                    layer._colormap = widget._datasrc[d].colormap.map(colorfunc);

                    layer._hcmaps = hcmaps;

                    layer._xy = [widget.retx[i],widget.rety[j]];

                    var label='X: '+hexToColor(widget.retx[i])+
                              ' Y: '+hexToColor(widget.rety[j]);
                    
                    layers[label] = layer;
                }
            }
        }
        return layers;
    },
    
    _initMap: function(viewbbox){
        var widget = this;
        
        //Leaflet stuffs
        var map = L.map(this._name,{detectRetina:true,
                                    attribution: '<a href="https://www.mapbox.com/about/maps/">Terms and Feedback</a>'});

        //make the background black
        $('.leaflet-container').css('background','#000');

        //add an OpenStreetMap tile layer
        var mapt = L.tileLayer(this._tilesurl,{
            noWrap:true,
            opacity:0.4,
            maxZoom: Math.min(this._maxlevels-8, 18),
            zIndex: -1000
        });

        //add base layer
        map.addLayer(mapt);

        //add nanocube layers
        for (var l in this._layers){
            map.addLayer(this._layers[l]);
        }

        //Layer
        map.layercontrol = L.control.layers(this._layers, null,
                                             {
                                                 collapsed: false,
                                                 position: 'bottomright'
                                             });
        map.layercontrol.addTo(map);

        map.on('baselayerchange', function(e){
            // console.log("what");
            e.layer._reset();
            // e.layer.bringToBack();
            // mapt.bringToBack();
            widget.updateCallback(widget._encodeArgs(),[],
                                  widget._datasrc);
        });


        map.on('overlayadd', function (e) {
            widget._datasrc[e.layer._datasrc].disabled=false;
            widget.updateCallback(widget._encodeArgs(),[],
                                  widget._datasrc);
        });

        map.on('overlayremove', function (e) {
            widget._datasrc[e.layer._datasrc].disabled=true;
            widget.updateCallback(widget._encodeArgs(),[],
                                  widget._datasrc);
            
        });

        //Refresh after move
        map.on('moveend', function(){ //update other views
            widget.updateCallback(widget._encodeArgs(),[]);
        });

        //add keyboard hooks with JQuery
        $(map._container).keydown(function(e){
            widget._keyboardShortcuts(e);
        });

        this._maptiles = mapt;
        this._initDrawingControls(map);
        this._renormalize=true;

        //add info
        //$('#'+this._name).append('<p class="info">info test</p>');
        //style
        /*var infodiv = $('#'+this._name+" .info");
        infodiv.css({
            position: 'absolute',
            'z-index':1,
            color: 'white',
            'right': '20ch',
            'top': '0.5em',
            'padding':'0px',
            'margin':'0px'
        });*/

        //add title
        d3.select('#'+this._name)
            .append('div')
            .attr('class','maptitle')
            .text(this._name);
        
        return map;
    },

    _encodeArgs: function(){
        var map = this._map;
        var args= {};
        args.global = {c:map.getCenter(),z:map.getZoom()};

        return JSON.stringify(args);
    },

    _decodeArgs: function(s){
        var map = this._map;
        var args = JSON.parse(s);
        var v = args.global;
        
        map.setView(v.c,v.z);
    },
       
    _keyboardShortcuts: function(e){
        console.log(e);
        switch(e.keyCode){
        case 190: //.
            this.changeHeatmapRes(1);
            break;
        case 188: //,
            this.changeHeatmapRes(-1);
            break;
        case 66: //b
            this.changeMapOpacity(0.1);
            break;
        case 68: //d
            this.changeMapOpacity(-0.1);
            break;
        case 76: //l
            this._logheatmap = !this._logheatmap;
            this._renormalize = true;
            this.update();
            break;
        case 78: //n
            this._renormalize = true;
            this.update();
            break;
        default:
            return;
        }
    },

    _initDrawingControls: function(map){
        var drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);
        var widget = this;

        var initColor = widget.colornext();

        var drawingoptions = function(){
            return { shapeOptions:{ color: initColor } };
        };

        map.drawControl = new L.Control.Draw({
            draw: {
                rectangle: drawingoptions(),
                polygon: drawingoptions(),
                polyline:false,
                circle:false,
                marker:false
            },
            edit: {
                featureGroup: drawnItems,
                edit:{
                    selectedPathOptions: {maintainColor: true}
                }
            }
        });

        map.addControl(map.drawControl);

        var firstShape = true;
        var firstEdit = true;
        var latlng;
        // widget.compareShapes = [];


        map.on('draw:created', function (e) {
            drawnItems.addLayer(e.layer);
            console.log("Added in "+ widget.name);

            // if(widget.compare){
            //     widget.compareShapes.push(e.layer._leaflet_id);
            //     e.layer.setStyle({color: '#ffffff'});
            //     widget.updateCallback(widget._encodeArgs(),
            //                       [{
            //                           type:"SPATIAL",
            //                           key:"#ffffff"
            //                       }]);
            //     return;
            // }

            if(firstShape){
                // console.log(e.layer);
                var p1 = e.layer._latlngs[0];
                var p2 = e.layer._latlngs[1];
                var p3 = e.layer._latlngs[2];
                latlng = [2 * Math.abs(p1.lat - p2.lat) / 3 + Math.min(p1.lat, p2.lat), 
                          (p2.lng + p3.lng) / 2];
                firstShape = false;
                widget.colorNumber[initColor] = 0;
                widget.colorsUsed.push(initColor);
            }

            else{
                var nextColor = widget.colornext();
                widget.colorNumber[nextColor] = widget.colorsUsed.length;
                widget.colorsUsed.push(nextColor);
            }

            //keep track of color
            widget.newLayerColors[e.layer._leaflet_id] = e.layer.options.color;

            //add constraints to the other maps
            widget.updateCallback(widget._encodeArgs(), []);
            
            //Set color for the next shape
            // var options = {};
            // options[e.layerType] = drawingoptions();
            // map.drawControl.setDrawingOptions(options);
        });

        

        map.on('draw:editstart', function(e){

            var overlay = $('.leaflet-overlay-pane');
            // console.log(overlay.first(), overlay.last());
            // map.addLayer(drawnItems);

            // if(widget.compare){
            //     return;
            // }

            if(firstEdit){
                var popup = L.popup()
                    .setLatLng(latlng)
                    .setContent('<p>Double click inside a polygon to change its color!</p>')
                    .openOn(map);
                firstEdit = false;
            }

            drawnItems.on('dblclick', function(e){
                // console.log(drawnItems);
                // console.log(e.layer);
                var cn = widget.colorNumber[e.layer.options.color] + 1;
                if(cn >= widget.colorsUsed.length)
                    cn = 0;
                if(e.layer.lids){
                    e.layer.lids.map(function(k){
                        drawnItems._layers[k].setStyle({color: widget.colorsUsed[cn]});
                        widget.newLayerColors[k] = e.layer.options.color;
                    });

                }
                else{
                    e.layer.setStyle({color: widget.colorsUsed[cn]});
                    widget.newLayerColors[e.layer._leaflet_id] = e.layer.options.color;
                }
                
                widget.updateCallback(widget._encodeArgs(), []);
            });

        });

        map.on('draw:edited', function (e) {
            widget.updateCallback(widget._encodeArgs());
        });

        map.on('draw:editstop', function (e) {
            map.addLayer(drawnItems);
            drawnItems.eachLayer(function (layer) {
                var c = widget.newLayerColors[layer._leaflet_id];
                if(c !== undefined){
                    layer.setStyle({color: c});
                }
            });
            drawnItems.off('dblclick');
            widget.updateCallback(widget._encodeArgs());
        });

                    

        map.on('draw:editing', function (e) {
            widget.updateCallback(widget._encodeArgs()) ;          
        });

        map.on('draw:deleted', function(e) {
            //add constraints to the other maps
            widget.updateCallback(widget._encodeArgs());
        });

        map.on('draw:deletestart', function(e){
            drawnItems.on('click', function(e){
                if(e.layer.lids){
                    e.layer.lids.map(function(k){
                        widget._drawnItems.removeLayer(widget._drawnItems._layers[k]);
                    });

                }
            });
        });

        map.on('draw:deletestop', function(e){
            drawnItems.off('click');
        });

        $(document).on('dragenter', function (e) 
        {
            e.stopPropagation();
            e.preventDefault();
        });
        $(document).on('dragover', function (e) 
        {
          e.stopPropagation();
          e.preventDefault();
        });
        $(document).on('drop', function (e) 
        {
            e.stopPropagation();
            e.preventDefault();
        }); 

        var obj = $('#'+this._name);
        obj.on('dragenter', function (e) {
            e.stopPropagation();
            e.preventDefault();
        });
        obj.on('dragover', function (e) {
             e.stopPropagation();
             e.preventDefault();
        });
        obj.on('drop', function (e) {
            e.preventDefault();
            var files = e.originalEvent.dataTransfer.files;
            var r = new FileReader();
            r.onload = function(e) {
                var gj;
                if((typeof e.target.result) == 'object'){
                    var geojson = shp.parseZip(e.target.result);

                    gj = L.geoJson(geojson, {
                        style: {
                            "color": initColor,
                            "opacity": 0.7
                        }
                    });
                }
                try{

                    if(gj === undefined){
                        gj = L.geoJson(JSON.parse(e.target.result), {
                            style: {
                                "color": initColor,
                                "opacity": 0.7
                            }
                        });
                    }
                    if(firstShape){
                        var center = gj.getBounds().getCenter();
                        latlng = [center.lat, center.lng];
                        firstShape = false;
                        widget.colorNumber[initColor] = 0;
                        widget.colorsUsed.push(initColor);
                    }
                    else{
                        var nextColor = widget.colornext();
                        widget.colorNumber[nextColor] = widget.colorsUsed.length;
                        widget.colorsUsed.push(nextColor);
                    }
                    var col;
                    Object.keys(gj._layers).map(function(k){
                        if(gj._layers[k]._layers){
                            var lids = gj._layers[k].getLayers().map(function(k){
                                return k._leaflet_id;
                            });
                            Object.keys(gj._layers[k]._layers).map(function(l){
                                gj._layers[k]._layers[l].lids = lids;
                                drawnItems.addLayer(gj._layers[k]._layers[l]);
                                col = gj._layers[k]._layers[l].options.color;
                                widget.newLayerColors[gj._layers[k]._layers[l]._leaflet_id] = col;
                            });
                        }
                        else{
                            drawnItems.addLayer(gj._layers[k]);
                            col = gj._layers[k].options.color;
                            widget.newLayerColors[gj._layers[k]._leaflet_id] = col;
                        }
                    });

                    widget.updateCallback(widget._encodeArgs(), []);
                }
                catch(err){
                    console.log(err);
                }
            };
            for (var i = 0; i < files.length; i++){
                if(files[i].name.endsWith('.zip'))
                    try{
                        r.readAsArrayBuffer(files[i]);
                    }
                    catch(err){
                        console.log(err);
                    }

                else{
                    try{
                        r.readAsText(files[i]);
                    }
                    catch(err){
                        console.log(err);
                    }
                }
            }
        });

        this._drawnItems = drawnItems;

    },

    addConstraint:function(constraint){
        if(constraint.type != "SPATIAL"){
            return;
        }

        var map = this._map;

        var key = constraint.key;
        var event = constraint.event || null;

        var shape;
        if(!event){  // create a rect
            var s = map.getSize();
            var nw = map.containerPointToLatLng([s.x*0.25,s.y*0.25]); 
            var se = map.containerPointToLatLng([s.x*0.75,s.y*0.75]); 
            shape = L.rectangle([nw,se],{color:key});
        }

        this._drawnItems.addLayer(shape);
    },

    setSelection: function(key,v){
        var map =this._map;

        if (key == 'global'){
            if('c' in v && 'z' in v){
                //set the view
                map.setView(v.c,v.z);
            }
            else if (v.length==2){  //viewbox
                map.fitBounds(v);
            }
        }
    },

    getSelection: function(){
        var res = {};
        var map = this._map;

        var bb = map.getBounds();
        var sw = bb.getSouthWest();
        var ne = bb.getNorthEast();


        res.global = {};
        res.global.coord = [[[sw.lat,sw.lng],
                            [sw.lat,ne.lng],
                            [ne.lat,ne.lng],
                            [ne.lat,sw.lng]]];

        res.global.zoom = map.getZoom() + 8;

        if(!this.checkRet()){
            if(this._drawnItems.getLayers().length === 0){
                return res;
            }
            else{
                res.brush = {};
                res.brush.coord = [];
                this._drawnItems.getLayers().forEach(function(d){
                    res.brush.coord.push(d._latlngs.map(function(d){
                        return [d.lat,d.lng];
                    }));
                });
                res.brush.zoom = map.getZoom() + 8;
                res.global = undefined;
                return res;
            }
        }

        //add polygonal constraints  
        this._drawnItems.getLayers().forEach(function(d){
            if(res[d.options.color] && res[d.options.color].coord){
                res[d.options.color].coord
                    .push(d._latlngs.map(function(d){
                        return [d.lat,d.lng];
                    }));
            }
            else{
                res[d.options.color] = {};
                res[d.options.color] = {
                    coord: [d._latlngs.map(function(d){
                        return [d.lat,d.lng];
                    })],
                    zoom: map.getZoom() + 8
                };
            }                               
        });
        return res;
    },

    update: function(){
        var map = this._map;
        var widget = this;
        var xydata = this.getXYCallback();
        if(!arraysEqual(this.retx,xydata[0]) || !arraysEqual(this.rety,xydata[1])){
            console.log("Rebuilding..");
            this.retx = xydata[0];
            this.rety = xydata[1];
            for (var l1 in this._layers){
                map.removeLayer(this._layers[l1]);
                map.layercontrol.removeLayer(this._layers[l1]);

            }

            this._layers = this._genLayers(this._datasrc);
            for (var l2 in this._layers){

                map.layercontrol.addBaseLayer(this._layers[l2],l2);
            }
        }
        else{
            //force redraw
            this._map.fire('resize');
            // this._map.fire('moveend');
            this._map.fire('layerreset');


            // for (var l in map.layercontrol._layers){
            //     map.layercontrol._layers[l].layer._map = map;
            //     map.layercontrol._layers[l].layer._reset();
            // }
        }


        // for(var l in this._layers){
        //     var layer = this._layers[l];
        //     if (!this._datasrc[layer._datasrc].disabled){
        //         layer._reset();
        //     }
        // }


    },

    drawCanvasLayer: function(res,canvas,cmaps,opacity){
        var keys = Object.keys(res);
        var pb = res[keys[0]].opts.pb;
        var data = {};
        Object.keys(res).map(function(k){
            data[k] = res[k].data;
        });
        var arr = this.dataToArray(pb,data);
        // console.log(data, arr);
        this.render(arr[0],arr[1],pb,cmaps,canvas,opacity);

    },

    dataToArray: function(pb,data){
        var origin = pb.min;
        var width = pb.max.x-pb.min.x+1;
        var height = pb.max.y-pb.min.y+1;

        //var arr = new Array(width*height).map(function () { return 0;});
        var tarr = [];
        var max = [];

        //Explicit Loop for better performance
        Object.keys(data).map(function(k){
            var idx = Object.keys(data[k]);
        
            for (var i = 0, len = idx.length; i < len; i++) {
                var ii= idx[i];
                var d = data[k][ii];
                var _i = d.x - origin.x;
                var _j = d.y - origin.y;
                if(_i <0 || _j <0 || _i >=width || _j>=height){
                    continue;
                }
                var _idx =  _j*width+_i;
                if(tarr[_idx]){
                    if(Math.max.apply(null,tarr[_idx]) < d.val)
                        max[_idx] = k;
                    tarr[_idx].push(d.val);
                }
                else{
                    tarr[_idx] = [d.val];
                    max[_idx] = k;
                }
            }
        });

        // console.log(tarr);

        var arr = [];

        function add(a,b){
            return a + b;
        }

        var idx2 = Object.keys(tarr);
        for (var j = 0, len = idx2.length; j < len; j++) {
            var jj= idx2[j];
            var values = tarr[jj];
            var m = Math.max.apply(null, values);
            if(values.length == 1)
                arr[jj] = m;
            else{
                var rest = values.reduce(add, 0);
                rest -= m;
                rest /= (values.length - 1);
                arr[jj] = m - rest;
            }
        }
        // console.log(arr);

        return [arr, max];
    },

    normalizeColorMap: function(data,colors,log){
        var ext = d3.extent(data,function(d){
            return d.val;
        });

        var minv = ext[0];
        if (log){ //log
            ext = ext.map(function(d){return Math.log(d-minv+2);});
        }

        //compute domain
        var interval = (ext[1]-ext[0])/(colors.length-1);
        var domain=Array.apply(null,Array(colors.length)).map(function(d,i){
            return i*interval+ext[0];
        });

        if (log){ //anti log
            domain = domain.map(function(d){return Math.exp(d)+minv-2;});
        }

        return d3.scaleLinear().domain(domain).range(colors);
    },

    render: function(arr,max,pb,colormaps,canvas,opacity){
        var realctx = canvas.getContext("2d");        
        var width = pb.max.x-pb.min.x+1;
        var height = pb.max.y-pb.min.y+1;

        //create a proxy canvas
        var c = $('<canvas>').attr("width", width).attr("height", height)[0];
        var proxyctx = c.getContext("2d");
        var imgData = proxyctx.createImageData(width,height);

        var buf = new ArrayBuffer(imgData.data.length);
        var buf8 = new Uint8ClampedArray(buf);
        var pixels = new Uint32Array(buf);

        //Explicit Loop for better performance
        var idx = Object.keys(arr);
        var dom = {};

        Object.keys(colormaps).map(function(k){
            dom[k] = d3.extent(colormaps[k].domain());
        });

        for (var i = 0, len = idx.length; i < len; i++) {
            var ii= idx[i];
            var v = arr[ii];
            var k = max[ii];
            v = Math.max(v, dom[k][0]);
            v = Math.min(v, dom[k][1]);
            var color;
            color = colormaps[k](v);

            // color.a *= opacity;
            pixels[ii] =
                (color.a << 24) |         // alpha
                (color.b << 16) |         // blue
                (color.g <<  8) |         // green
                color.r;                  // red
        }

        imgData.data.set(buf8);
        proxyctx.putImageData(imgData, 0, 0);

        //Clear
        realctx.imageSmoothingEnabled = false;
        realctx.mozImageSmoothingEnabled = false;
        realctx.clearRect(0,0,canvas.width,canvas.height);

        //draw onto the real canvas ...
        realctx.drawImage(c,0,0,canvas.width,canvas.height);
    },

    _canvasDraw: function(layer,options){
        // console.log(layer);
        var canvas = options.canvas;

        // canvas.attr("transform", "translate3d(0px, 0px, -5px)");
        var ctx = canvas.getContext('2d');
        // console.log(ctx);
        

        var map = this._map;

        var z = map.getZoom();
        z = Math.min(z, this._maxlevels-8);
        z -= this._coarse_offset;

        var startdata = window.performance.now();
        var widget = this;

        var bb = map.getBounds();
        var nw = bb.getNorthWest();
        var se = bb.getSouthEast();

        var bbox = { min:[nw.lat,nw.lng], max:[se.lat,se.lng] } ;

        try{
            var promises = widget.getDataCallback(layer._datasrc,bbox,z);
            // console.log(promises);
            var promarray = Object.keys(promises).map(function(k){
                return promises[k];
            });
            var promkeys = Object.keys(promises);
            ctx.clearRect(0,0,canvas.width,canvas.height);
            $.when.apply($,promarray).done(function(){
                var results = arguments;
                var res = {};
                promkeys.forEach(function(d,i){
                    console.log('tiletime:',window.performance.now()-startdata);
                    var label = d.split('&-&');
                    var xyc = label[0].split('&');
                    var ret = {};
                    xyc.map(function(k){
                        ret[k.charAt(0)] = k.substring(1);
                    });

                    //check ret.x, ret.y
                    if(ret.x != layer._xy[0] && layer._xy[0] != 'default')
                        return;
                    if(ret.y != layer._xy[1] && layer._xy[1] != 'default')
                        return;

                    if(ret.c){
                        res[ret.c] = results[i];
                    }
                    else{
                        res.global = results[i];
                    }
                });
                widget._renormalize = true;
                if(widget._renormalize){
                    var cmaps = {};
                    Object.keys(res).map(function(c){
                        if(c == 'global'){
                            cmaps.global = widget.normalizeColorMap(res.global.data,
                                                                    layer._colormap,
                                                                    widget._logheatmap);
                        }
                        else{
                            cmaps[c] = widget.normalizeColorMap(res[c].data,
                                                                layer._hcmaps[c],
                                                                widget._logheatmap);
                        }
                    });
                    layer._cmaps = cmaps;
                    widget._renormalize = false;

                    if(widget._opts.legend){
                        //idk
                    }
                }
                var startrender = window.performance.now();
                widget.drawCanvasLayer(res,canvas,layer._cmaps,layer.options.opacity);
                console.log('rendertime:', window.performance.now()-startrender);
            });
        }
        catch(err){
            ctx.clearRect(0,0,canvas.width,canvas.height);
            console.log(err);
        }
    },
    changeHeatmapRes: function(levels){
        var offset = this._coarse_offset+levels;
        offset = Math.max(0,offset);
        offset = Math.min(8,offset);
        this._coarse_offset = offset;
        this.update(); //force redraw
    },
    changeMapOpacity: function(o){
        var op = this._maptiles.options.opacity+o;
        op = Math.max(0.0,op);
        op = Math.min(1.0,op);
        this._maptiles.setOpacity(op);
    },

    updateInfo: function(html_str){
        $('#'+this._name+" .info").html(html_str);
    },

    _addLegend: function(map){
        var legend = L.control({position: 'bottomleft'});
        
        legend.onAdd = function (map) {
            var div = L.DomUtil.create('div', 'legendinfo legend');
            return div;
        };          

        legend.addTo(map);
    },
    updateLegend: function(map,valcolor){
        var legend = d3.select(map._container).select('.legend');
        var htmlstr= valcolor.map(function(d) {
            var colorstr = 'rgb('+parseInt(d.color.r) +','+parseInt(d.color.g)+','+parseInt(d.color.b)+')';
            return '<i style="background:'+colorstr+'"></i>' + d.val;
        });
        legend.html(htmlstr.join('<br />'));
    },
    checkRet: function(){
        return this.retbrush.color == this._name || this.retbrush.x == this._name ||
            this.retbrush.y == this._name;
    },
    adjustToCompare: function(){
        // var map = this._map;
        // var widget = this;
        // if(this.compare){
        //     widget._drawnItems.eachLayer(function (layer) {
        //         layer.setStyle({color: '#ffffff'});
        //     });
        //     widget.updateCallback(widget._encodeArgs());
        // }
        // else{
        //     widget.compareShapes.map(function(k){
        //         widget._drawnItems.removeLayer(widget._drawnItems._layers[k]);
        //         // delete widget._drawnItems._layers[k];
        //         // map.removeLayer(widget._drawnItems._layers[k]);
        //     });
        //     // console.log(widget._drawnItems);
        //     widget._drawnItems.eachLayer(function (layer) {
        //         // console.log(widget.newLayerColors);
        //         var c = widget.newLayerColors[layer._leaflet_id];
        //         if(c !== undefined){
        //             layer.setStyle({color: c});
        //         }
        //     });
        //     widget.updateCallback(widget._encodeArgs());
        // }
    }
};

/*global $ */


var cache = {};

//Query
var Query = function(nc){
    this.nanocube = nc;
    this.dimension = null ;
    this.drilldown_flag = false;
    this.query_elements = {};

    //constrains
    this.catconst = {};
    this.idconst = {};
    this.spatialconst = {};
    this.temporalconst = {};
};

Query.prototype = {
    //Functions for setting Constraints
    setConstraint: function(varname,c){
        if(!(varname in this.nanocube.dimensions)){
            return this;
        }

        switch(this.nanocube.dimensions[varname].vartype){
        case 'quadtree':
            return this.setSpatialConst(varname, c);
        case 'cat':
            return this.setCatConst(varname, c);
        case 'time':
            return this.setTimeConst(varname, c);
        case 'id':
            return this.setIdConst(varname, c);
        default:
            return this;
        }
    },

    setSpatialConst: function(varname, sel) {
        var tiles = sel.coord.map(function(c){

        });

        var coordstr;
        if(sel.coord.length > 1){
            coordstr = sel.coord.map(function(p){
                var cs = p.map(function(c){
                    c[0] = Math.max(-85,c[0]);
                    c[0] = Math.min(85,c[0]);
                    c[1] = Math.max(-180,c[1]);
                    c[1] = Math.min(180,c[1]);
                    return c[1].toFixed(4) +","+ c[0].toFixed(4);
                });
                cs = cs.join(',');
                return cs;
            });
            coordstr = coordstr.join(';');
        }
        else{
            coordstr = sel.coord[0].map(function(c){
                c[0] = Math.max(-85,c[0]);
                c[0] = Math.min(85,c[0]);
                c[1] = Math.max(-180,c[1]);
                c[1] = Math.min(180,c[1]);
                return c[1].toFixed(4) +","+ c[0].toFixed(4);
            });
            coordstr = coordstr.join(',');
        }

        var zoom = sel.zoom;
        var constraint = 'r(\"' + varname + '\",degrees_mask(\"' +
                coordstr + '\",' + zoom + '))';

        this.query_elements[varname] = constraint;

        //record constraint
        var constlist = this.spatialconst[varname]  || [];
        constlist.push(tiles);
        this.spatialconst[varname]=constlist;
        return this;
    },

    setTimeConst: function(varname, timeconst) {
        var start = this.nanocube.timeToBin(timeconst.start);
        var end = this.nanocube.timeToBin(timeconst.end);

        
        start = Math.floor(start);
        end = Math.ceil(end);
        if(end < 0){
            end=1;
            start=2;
        }

        start = Math.max(start,0);
        var constraint = 'r(\"' + varname + '\",interval(' +
                start + ',' + end + '))';
        this.query_elements[varname] = constraint;

        //record timeconst
        this.temporalconst[varname]={start:start, end:end, binsize: 1};
        return this;
    },

    setCatConst: function(varname, catvalues) {
        var q = this;
        var valnames = q.nanocube.dimensions[varname].valnames;
        
        var values = catvalues.map(function(d){
            return {cat: d.cat, id: valnames[d.cat] };
        });   
                                   
        if (values.length > 0){
            var constraint = 'r("'+varname+'",'+'set('+values.map(function(d){
                return d.id;
            }).join(',') +'))';

            this.query_elements[varname] = constraint;
        }

        //record catconst
        this.catconst[varname]= catvalues;
        return this;
    },


    setIdConst: function(varname, idvalues) {
        //console.log(idvalues);
        var values = idvalues.map(function(d){ return d.id; });
                                   
        if (values.length > 0){
            var constraint = 'ids('+values.join(',') +')';
            this.query_elements[varname] = constraint;
        }

        //record catconst
        this.idconst[varname]= idvalues;
        
        return this;
    },
        
    queryTime: function(varname, base, bucketsize, count) {
        var constraint = 'r(\"' + varname + '\",mt_interval_sequence(' +
                base + ',' + bucketsize + ',' + count + '))';
        this.timebucketsize = bucketsize;
        this.query_elements[varname] = constraint;

        //record timeconst
        this.timeconst={start:base, end:base+bucketsize*count-1,
                        bucketsize:bucketsize};

        var dfd = new $.Deferred();
        
        if((base+count) < 0){
            dfd.resolve({timeconst: this.timeconst,
                         timearray: []});
            return dfd.promise();
        }
        base = Math.max(0,base);

        
        this._run_query(this).done(function(data){
            var q = this;
            if (!('children' in data.root)){
                dfd.resolve({timeconst:q.timeconst, timearray:[]});
                return;
            }

            data = data.root.children;
            var timearray = data.map(function(d){
                var t = d.path[0];
                var v = d.val; //old style
                if(typeof(d.val.volume_count) != 'undefined'){
                    v = d.val.volume_count;
                }

                return { time: t, val: v };
            });

            
            dfd.resolve({timeconst: q.timeconst,
                         timearray: timearray});
            return;
        });
        return dfd.promise();
    },

    queryTile:function(varname,t,drill) {
        var z = t.z;
        var h =  1 << z;
        var th =  1 << drill;
        var x = Math.min(Math.max(0,t.x),h);
        var y = Math.min(Math.max(0,h-1-t.y),h);  //Flip Y


        var tile2d = "tile2d(" + x + "," + y + "," + z + ")";

        var constraint = "a(\"" + varname + "\",dive(" + tile2d +
                "," + drill + "),\"img\")";

        this.query_elements[varname] = constraint;
        this.tile = {x:x,y:y,z:z};
        this.drill = drill;

        var dfd = new $.Deferred();

        this._run_query(this).done(function(data){
            if (!data.root.children){
                dfd.resolve([]);
                return;
            }

            data = data.root.children;
            //flip Y
            var z = this.tile.z+this.drill;
            var query = this;
            var offset = {x:this.tile.x*256,y:(h-1-this.tile.y)*256};

            data = data.map(function(d){
                if(d.path){
                    d.x = d.path[0];
                    d.y = d.path[1];
                }

                if(typeof(d.val.volume_count) != 'undefined'){
                    d.val = d.val.volume_count;
                }

                d.x =  d.x + offset.x;
                d.y = th-d.y + offset.y;
                d.z = z;

                return d;
            });
            
            data = data.filter (function(d){
                return d.val !== 0;
            });
            dfd.resolve(data);
            return;
        });
        return dfd.promise();
    },
    _pathToXY: function(path){
        var xypath = path.map(function(d,i){
            var nthbit = path.length-1-i;
            var x = ((d >> 0) & 1) << nthbit; //x 0th bit
            var y = ((d >> 1) & 1) << nthbit; //y 1st bit
            return {x:x, y:y};
        });
        return xypath.reduce(function(p,c){
            return {x: p.x|c.x, y:p.y|c.y};
        });
    },
    toString: function(type) {
        var qelem = this.query_elements;
        var dims = Object.keys(qelem);
        var vals = dims.map(function(d) {
            return qelem[d];
        });

        var query_string = vals.join('.');
        return this.nanocube.url + '/' + type + '.' + query_string;
    },

    _run_query: function(ctx,query_cmd){
        query_cmd = query_cmd || 'count';

        var query_string = this.toString(query_cmd);

        var dfd = $.Deferred();
        if (cache[query_string]){
            //console.log('cached');
            var res = $.extend(true, {}, cache[query_string]);
            dfd.resolveWith(ctx, [res]);
            return dfd.promise();
        }
        else{
            // console.log(query_string);
            $.ajax({url: query_string, context: ctx}).done(function(res){
                if(Object.keys(cache).length > 10){
                    var idx = Math.floor(Math.random() * (10+1)) ;
                    var k = Object.keys(cache)[idx];
                    delete cache[k];
                }
                cache[query_string] = $.extend(true, {}, res);
                dfd.resolveWith(ctx, [res]);
            });

            return dfd.promise();
        }
    },


    categorialQuery: function(varname){
        var constraint = "a(\"" + varname + "\",dive([],1)) ";
        this.query_elements[varname] = constraint;

        var dfd = new $.Deferred();

        this.valnames = this.nanocube.dimensions[varname].valnames;
        this._run_query(this).done(function(data){
            if (!data.root.children){
                return dfd.resolve({type:'cat',data:[]});
            }

            data = data.root.children;
            var q = this;

            //set up a val to name map
            var valToName = {};
            for (var name in q.valnames){
                valToName[q.valnames[name]] = name;
            }

            var catarray = data.map(function(d){
                return { id: d.path[0], cat: valToName[d.path[0]], val: d.val };
            });

            return dfd.resolve({type:'cat', data:catarray});
        });
        return dfd.promise();
    },

    //Top K query
    topKQuery: function(varname, n){
        var constraint = "k("+n+")";
        this.query_elements[varname] = constraint;

        var dfd = new $.Deferred();

        this.valnames = this.nanocube.dimensions[varname].valnames;
        this._run_query(this,'topk').done(function(data){
            if (!data.root.val.volume_keys){
                return dfd.resolve({type:'id', data: []});
            }
            
            data = data.root.val.volume_keys;
            var q = this;
            var idarray = data.map(function(d){
                return {id:d.key,cat:d.word,val:d.count};
            });
            
            return dfd.resolve({type:'id', data: idarray});
        });
        return dfd.promise();
    },
    
    //temporal queries, return an array of {date, val}
    temporalQuery: function(varname,start,end,interval_sec){
        // console.log(start, end);
        var q = this;
        var timeinfo = q.nanocube.getTbinInfo();
        
        var startbin = q.nanocube.timeToBin(start);
        
        var bucketsize = interval_sec / timeinfo.bin_sec;
        bucketsize = Math.max(1,Math.floor(bucketsize+0.5));

        var endbin = q.nanocube.timeToBin(end);
        // console.log(endbin, startbin);
        startbin = Math.floor(startbin);
        endbin = Math.floor(endbin);
        
        var count = (endbin - startbin) /bucketsize + 1 ;
        count = Math.floor(count);

        var dfd = new $.Deferred();

        if(endbin==startbin){
            dfd.resolve(null);
            return dfd.promise();
        }
        startbin = Math.max(startbin,0);

        q.queryTime(varname,startbin,bucketsize,count).done(function(res){
            //make date and count for each record
            var nbins = res.timeconst.end - res.timeconst.start;
            nbins = nbins/res.timeconst.bucketsize+1;
            nbins = Math.floor(nbins);
            var datecount = new Array(nbins);
            for(var i=0; i < nbins; i++){
                var t = q.nanocube.bucketToTime(i,res.timeconst.start,
                                                res.timeconst.bucketsize);
                datecount[i]= {time:t,  val:0};
            }

            res.timearray.forEach(function(d,i){
                datecount[d.time].val = d.val;
            });

            //kill zeros
            datecount = datecount.filter(function(d){return d.val !== 0;});
            ///////
            dfd.resolve({type:'temporal', data:datecount,
                         timeconst:res.timeconst });
        });
        return dfd.promise();
    },

    spatialQuery: function(varname,bb,z, maptilesize){
        maptilesize = maptilesize || 256;

        var q = this;

        var tilesize_offset = Math.log(maptilesize)/Math.log(2);
        var pb = { min:{ x: long2tile(bb.min[1],z+tilesize_offset),
                         y: lat2tile(bb.min[0],z+tilesize_offset) },
                   max:{ x: long2tile(bb.max[1],z+tilesize_offset),
                         y: lat2tile(bb.max[0],z+tilesize_offset) }
                 };


        var queries = [];
        var maxlevel = this.nanocube.dimensions[varname].varsize;
        var drill = Math.max(0,Math.min(z+8,8));

        var tilesize = 1 << drill;
        var tbbox = {min:{x: Math.floor(pb.min.x / tilesize),
                          y: Math.floor(pb.min.y / tilesize)},
                     max:{x: Math.floor(pb.max.x / tilesize),
                          y: Math.floor(pb.max.y / tilesize)}};

        z = Math.max(0,Math.min(z,maxlevel-8) );

        var h = 1 << z;

        for (var i=Math.floor(tbbox.min.x);i<=Math.floor(tbbox.max.x);i++){
            for (var j=Math.floor(tbbox.min.y);j<=Math.floor(tbbox.max.y);j++){
                if (i < 0 || j < 0 || i >=h || j>=h){
                    continue;
                }

                var clone_q = $.extend({},q);
                queries.push(clone_q.queryTile(varname,{x:i,y:j,z:z},drill));
            }
        }

        var dfd = new $.Deferred();
        $.when.apply($, queries).done(function(){
            var results = arguments;
            var merged = [];
            merged = merged.concat.apply(merged, results);
            dfd.resolve({type: 'spatial', opts:{pb:pb}, data:merged});
        });
        return dfd.promise();
    }
};

var Nanocube = function(opts) {
    this.schema = null ;
    this.dimensions = null ;
};

Nanocube.initNanocube = function(url){
    var nc = new Nanocube();
    return nc.setUrl(url);
};

Nanocube.prototype = {
    setUrl: function(url){
        var dfd  = new $.Deferred();
        this.url = url;
        var schema_q = this.url + '/schema';

        $.ajax({url: schema_q, context:this}).done(function(schema) {
            var nc = this;
            this.setSchema(schema);
            this.setTimeInfo().done(function() {
                dfd.resolve(nc);
            });
        }).fail(function() {
            console.log('Failed to get Schema from ', url);
        });

        return dfd.promise();
    },
    query: function() {
        return new Query(this);
    },

    setSchema:function(json) {
        this.schema = json;
        var dim = this.schema.fields.filter(function(f) {
            return f.type.match(/^path\(|^id\(|^nc_dim/);
        });
        
        var dimensions = {};
        dim.forEach(function(d){
            dimensions[d.name] = d;
            //Match the variable type and process 
            switch(d.type.match(/^path\(|^id\(|^nc_dim_/)[0]){
            case 'path(': //new style for time / spatial / cat
                var m =  d.type.match(/path\(([0-9]+),([0-9]+)\)/i);
                var bits = +m[1];
                var levels = +m[2];
                
                switch(bits){
                case 1: //time dim
                    dimensions[d.name].vartype = 'time';
                    dimensions[d.name].varsize=levels/8;
                    break;
                case 2: //spatial dim
                    dimensions[d.name].vartype = 'quadtree';
                    dimensions[d.name].varsize=levels;
                    break;
                default: //cat dim
                    dimensions[d.name].vartype = 'cat';
                    dimensions[d.name].varsize = Math.pow(bits,levels)/8;
                }
                break;

            case 'id(': // topk id
                dimensions[d.name].vartype = 'id';
                break;

            case 'nc_dim_': //old style
                var oldm = d.type.match(/nc_dim_(.*)_([0-9]+)/i);
                
                dimensions[d.name].vartype = oldm[1];
                dimensions[d.name].varsize = +oldm[2];
            }
        });
        this.dimensions = dimensions;
    },

    
    setTimeInfo: function() {
        var dim = this.dimensions;

        var tvar = Object.keys(dim).filter(function(k){
            return dim[k].vartype === 'time';
        });

        tvar = dim[tvar[0]];
        //var twidth = +tvar.type.match(/_([0-9]+)/)[1];
        
        var twidth = tvar.varsize;   //+tvar.type.match(/_([0-9]+)/)[1];
        var maxtime = Math.pow(2,twidth*8)-1;

        var dfd = new $.Deferred();

        this.timeinfo = this.getTbinInfo();
        var tinfo = this.timeinfo;

        this.getTimeBounds(tvar.name,0,maxtime).done(function(t){
            tinfo.start = t.mintime;
            tinfo.end = t.maxtime;
            tinfo.nbins = (t.maxtime-t.mintime+1);
            dfd.resolve();
            return;
        });
        return dfd.promise();
    },

    getTimeBounds: function(tvarname,mintime,maxtime){
        var dfd = new $.Deferred();
        var minp = this.getMinTime(tvarname,mintime,maxtime);
        var maxp = this.getMaxTime(tvarname,mintime,maxtime);
        $.when(minp,maxp).done(function(mintime,maxtime){
            dfd.resolve({mintime:mintime,maxtime:maxtime});
        });
        return dfd.promise();
    },

    getMinTime: function(tvarname,mintime,maxtime){
        var q = this.query();

        var dfd = new $.Deferred();
        //base case
        if((maxtime - mintime) < 2){
            return dfd.resolve(mintime);
        }

        var nc = this;
        var interval = Math.ceil((maxtime-mintime)/100000);
        q.queryTime(tvarname,mintime,interval,100000).done(function(res){
            var timearray = res.timearray;
            var timeconst = res.timeconst;
            var minp = timearray.reduce(function(p,c){
                if (p.time < c.time){
                    return p;
                }
                else{
                    return c;
                }
            });

            var mint = minp.time *timeconst.bucketsize;
            var end = (minp.time+1)*timeconst.bucketsize-1;
            mint += timeconst.start;
            end += timeconst.start;
            nc.getMinTime(tvarname,mint,end).done(function(m){
                return dfd.resolve(m);
            });
        });
        return dfd.promise();
    },

    getMaxTime: function(tvarname,mintime,maxtime){
        var q = this.query();

        var dfd = new $.Deferred();
        //base case
        if((maxtime - mintime) < 2){
            return dfd.resolve(maxtime);
        }

        var nc = this;
        var interval = Math.ceil((maxtime-mintime)/100000);
        q.queryTime(tvarname,mintime,interval,100000).done(function(res){
            var timearray = res.timearray;
            var timeconst = res.timeconst;
            var maxp = timearray.reduce(function(p,c){
                if (p.time > c.time){
                    return p;
                }
                else{
                    return c;
                }
            });

            var maxt = maxp.time * timeconst.bucketsize;
            var end = (maxp.time +1) * timeconst.bucketsize-1;
            maxt += timeconst.start;
            end += timeconst.start;
            nc.getMaxTime(tvarname,maxt,end).done(function(m){
                return dfd.resolve(m);
            });
        });
        return dfd.promise();
    },

    getTbinInfo: function() {
        if (this.timeinfo){
            return this.timeinfo;
        }
        
        var tbininfo = this.schema.metadata.filter(function(f) {
            return ( f.key === 'tbin') ;
        });

        var s = tbininfo[0].value.split('_');
        var offset = new Date(s[0]+'T'+s[1]+'Z');

        var res;
        var sec = 0;
        res = s[2].match(/([0-9]+)m/);
        if (res) {
            sec += +res[1]*60;
        }
        res = s[2].match(/([0-9]+)s/);
        if (res) {
            sec = +res[1];
        }

        res = s[2].match(/([0-9]+)h/);
        if (res) {
            sec = +res[1]*60*60;
        }

        res = s[2].match(/([0-9]+)[D,d]/);
        if (res) {
            sec = +res[1]*60*60*24;
        }
        return {
            date_offset: offset,
            bin_sec: sec
        };
    },

    timeToBin: function(t){
        //translate time to bin
        var timeinfo = this.timeinfo;
        var sec = (t - timeinfo.date_offset) / 1000.0;
        var bin = sec / timeinfo.bin_sec;
        bin = Math.max(bin,timeinfo.start-1);
        bin = Math.min(bin,timeinfo.end+1);
        return bin;
        
    },

    bucketToTime: function(t, start, bucketsize){
        start = start || 0;
        bucketsize = bucketsize || 1;
        var timeinfo = this.timeinfo;

        //Translate timebins to real dates
        var base= new Date(timeinfo.date_offset.getTime());

        //add time offset from query
        base.setSeconds(start * timeinfo.bin_sec);

        //make date and count for each record
        var offset = timeinfo.bin_sec * bucketsize * t;
        var time= new Date(base.getTime());
        time.setSeconds(offset);
        return time;
    }
};

//Lat Long to Tile functions from
//https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames#Lon..2Flat._to_tile_numbers

function long2tile(lon,zoom) {
    return (Math.floor((lon+180)/360*Math.pow(2,zoom)));
}

function lat2tile(lat,zoom)  {
    return (Math.floor((1-Math.log(Math.tan(lat*Math.PI/180) +
                                   1/Math.cos(lat*Math.PI/180))/Math.PI)/2*
                       Math.pow(2,zoom)));
}

function tile2long(x,z) {
    return (x/Math.pow(2,z)*360-180);
}

function tile2lat(y,z) {
    var n=Math.PI-2*Math.PI*y/Math.pow(2,z);
    return (180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))));
}

function latlong2tile(latlong,zoom) {
    return { x: long2tile(latlong[1],zoom),
             y: lat2tile(latlong[0],zoom),
             z: zoom};
}

/*global $,d3 */

function Timeseries(opts,getDataCallback,updateCallback, getXYCallback){
	var id = '#'+ opts.name.replace(/\./g,'\\.');
    var widget = this;

    //Make draggable and resizable
    d3.select(id).attr("class","timeseries resize-drag"); //add resize-drag later

    d3.select(id).on("divresize",function(){
        widget.update();
    });

    //Collapse on dbl click
    // d3.select(id).on('dblclick',function(d){
    //     var currentheight = d3.select(id).style("height");
    //     if ( currentheight != "40px"){
    //         widget.restoreHeight = currentheight ;
    //         d3.select(id).style('height','40px');
    //     }
    //     else{
    //         d3.select(id).style('height',widget.restoreHeight);
    //     }
    // });

    this._opts = opts;

    opts.numformat = opts.numformat || ",";

    this._datasrc = opts.datasrc;

    widget.getDataCallback = getDataCallback;
    widget.updateCallback =  updateCallback;
    widget.getXYCallback = getXYCallback;

    this.retbrush = {
    	color:'',
    	x:'',
    	y:''
    };

    this.retx = ['default'];
    this.rety = ['default'];

    // console.log(this.retx, this.rety);


    var margin = opts.margin;
    if (margin === undefined)
        margin = {top: 10, right: 30, bottom: 20, left: 50};

    widget.permleft = margin.left;

    var width = $(id).width() - margin.left - margin.right - 60;
    var height = $(id).height() - margin.top - margin.bottom - 70;
    								//30 from sliders above and below

    //Nested SVG layers
    widget.toplayer = d3.select(id).append("div")
    	.style("width", $(id).width() + "px")
    	.style("height", 40 + "px")
    	.attr("class", "toplayer");

    widget.midlayer = d3.select(id).append("div")
    	.style("width", $(id).width() + "px")
    	.style("height", height + margin.top + margin.bottom + "px")
    	.attr("class", "midlayer");

    widget.midleft = widget.midlayer.append("div")
    	.style("width", 30)
    	.style("height", height + margin.top + margin.bottom + "px")
    	.attr("class", "midleft");

    widget.timespace = widget.midlayer.append("div")
    	.style("width", width + margin.left + margin.right + "px")
    	.style("height", height + margin.top + margin.bottom + "px")
    	.attr("class", "timespace");

    widget.midright = widget.midlayer.append("div")
    	.style("width", 30)
    	.style("height", height + margin.top + margin.bottom + "px")
    	.attr("class", "midright");

    widget.botlayer = d3.select(id).append("div")
    	.style("width", $(id).width() + "px")
    	.style("height", 30 + "px")
    	.attr("class", "botlayer");


	//Animation step slider
	var asx = d3.scaleLinear()
    	.domain([0, 5])
    	.range([0, 200])
    	.clamp(true);

    widget.asslider = widget.toplayer.append("svg")
    	.attr("width", 250)
    	.attr("height", 40)
    	.attr("class", "as-slider")
    	.append("g")
    	.attr("transform", "translate(" + 25 + "," + 20 + ")");

    d3.select(widget.asslider.node().parentNode).append("text")
    	.attr("x", 100)
    	.attr("y", 12)
    	.attr("font-family", "sans-serif")
    	.attr("font-size", "10px")
    	.attr("text-anchor", "center")
    	.attr("fill", "white")
    	.text("Animation Step");

    widget.asslider.append("line")
    	.attr("class", "track")
    	.attr("x1", asx.range()[0])
    	.attr("x2", asx.range()[1])
    .select(function() { return this.parentNode.appendChild(this.cloneNode(true)); })
    	.attr("class", "track-inset")
	.select(function() { return this.parentNode.appendChild(this.cloneNode(true)); })
    	.attr("class", "track-overlay")
    	.call(d3.drag()
    		.on("start.interrupt", function(){widget.asslider.interrupt(); })
    		.on("drag", function(){                                                                   
    			var h = Math.round(asx.invert(d3.event.x));
    			currentstep = h;
    			ashandle.attr("cx", asx(h));
    			widget.playTime(play_stop, currentspeed, h, ref);
    		}));

    var aslist = ["Auto", "Hour", "Day", "Week", "Month", "Year"];
    widget.asslider.insert("g", ".track-overlay")
    	.attr("class", "ticks")
    	.attr("transform", "translate(0," + 18 + ")")
    .selectAll("text")
    .data([5, 4, 3, 2, 1, 0])
    .enter().append("text")
    	.attr("x", asx)
    	.attr("text-anchor", "middle")
    	.attr("fill", "white")
    	.text(function(d) { return aslist[d];});

    var ashandle = widget.asslider.insert("circle", ".track-overlay")
    	.attr("class", "handle")
    	.attr("r", 6);


	//Speed Slider
    var sx = d3.scaleLinear()
    	.domain([0, 999])
    	.range([0, 200])
    	.clamp(true);

    widget.slider = widget.toplayer.append("svg")
    	.attr("width", 250)
    	.attr("height", 40)
    	.attr("class", "spd-slider")
    	.append("g")
    	.attr("transform", "translate(" + 25 + "," + 20 + ")");

    d3.select(widget.slider.node().parentNode).append("text")
    	.attr("x", 110)
    	.attr("y", 12)
    	.attr("font-family", "sans-serif")
    	.attr("font-size", "10px")
    	.attr("text-anchor", "center")
    	.attr("fill", "white")
    	.text("Speed");

    widget.slider.append("line")
    	.attr("class", "track")
    	.attr("x1", sx.range()[0])
    	.attr("x2", sx.range()[1])
    .select(function() { return this.parentNode.appendChild(this.cloneNode(true)); })
    	.attr("class", "track-inset")
	.select(function() { return this.parentNode.appendChild(this.cloneNode(true)); })
    	.attr("class", "track-overlay")
    	.call(d3.drag()
    		.on("start.interrupt", function(){widget.slider.interrupt(); })
    		.on("drag", function(){                                                            
    			var h = sx.invert(d3.event.x);
    			currentspeed = h;
    			handle.attr("cx", sx(h));
    			widget.playTime(play_stop, h, currentstep, ref);
    		}));

    widget.slider.insert("g", ".track-overlay")
    	.attr("class", "ticks")
    	.attr("transform", "translate(0," + 18 + ")")
    .selectAll("text")
    .data([999, 800, 600, 400, 200, 0])
    .enter().append("text")
    	.attr("x", sx)
    	.attr("text-anchor", "middle")
    	.attr("fill", "white")
    	.text(function(d) { return (1000 - d) + " ms";});

    var handle = widget.slider.insert("circle", ".track-overlay")
    	.attr("class", "handle")
    	.attr("r", 6);

	//Brush play button
    var play_stop = false;
    var ref = {};
    var currentspeed = 0;
    var currentstep = 0;

    this.forwardbtn = widget.toplayer.append('button')
        .attr('class', 'play-btn')
        .on('click',function(){
            if(d3.brushSelection(widget.anygbrush.node()) !== null){
                widget.iterateTime(currentstep, 1);
            }
        }).html(">");

    this.playbtn = widget.toplayer.append('button')
        .attr('class', 'play-btn')
        .on('click',function(){
            if(d3.brushSelection(widget.anygbrush.node()) !== null){
                play_stop = !play_stop;
                widget.playTime(play_stop, currentspeed, currentstep, ref);
            }
        }).html("Play");

    this.backbtn = widget.toplayer.append('button')
        .attr('class', 'play-btn')
        .on('click',function(){
            if(d3.brushSelection(widget.anygbrush.node()) !== null){
                widget.iterateTime(currentstep, -1);
            }
        }).html("<");

    //Brush snapping slider
    var bslist = ["Hour", "Day", "Week", "Month", "Year"];

    var bsx = d3.scaleLinear()
    	.domain([0, 4])
    	.range([0, 150])
    	.clamp(true);

    widget.bsslider = widget.toplayer.append("svg")
    	.attr("width", 200)
    	.attr("height", 40)
		.append("g")
    	.attr("class", "slider")
    	.attr("transform", "translate(" + 25 + "," + 20 + ")");

    d3.select(widget.bsslider.node().parentNode).append("text")
    	.attr("x", 75)
    	.attr("y", 12)
    	.attr("font-family", "sans-serif")
    	.attr("font-size", "10px")
    	.attr("text-anchor", "center")
    	.attr("fill", "white")
    	.text("Snap-to-grid");


    widget.bsslider.append("line")
    	.attr("class", "track")
    	.attr("x1", bsx.range()[0])
    	.attr("x2", bsx.range()[1])
    .select(function() { return this.parentNode.appendChild(this.cloneNode(true)); })
    	.attr("class", "track-inset")
	.select(function() { return this.parentNode.appendChild(this.cloneNode(true)); })
    	.attr("class", "track-overlay")
    	.call(d3.drag()
    		.on("start.interrupt", function(){widget.bsslider.interrupt(); })
    		.on("drag", function(){                                                                       
    			var h = Math.round(bsx.invert(d3.event.x));
    			brushsnap = h;
    			bshandle.attr("cx", bsx(h));
    		}));

    widget.bsslider.insert("g", ".track-overlay")
    	.attr("class", "ticks")
    	.attr("transform", "translate(0," + 18 + ")")
    .selectAll("text")
    .data([4, 3, 2, 1, 0])
    .enter().append("text")
    	.attr("x", bsx)
    	.attr("text-anchor", "middle")
    	.attr("fill", "white")
    	.text(function(d) { return bslist[d];});

    var bshandle = widget.bsslider.insert("circle", ".track-overlay")
    	.attr("class", "handle")
    	.attr("r", 6);

    //Brush Selection Text
    widget.bstextsvg = widget.toplayer.append("svg")
    	.attr("width", 400)
    	.attr("height", 30);

    widget.bstext = widget.bstextsvg.append("text")
    	.attr("x", 10)
    	.attr("y", 15)
    	.text("No Brush Selected")
    	.attr("font-family", "Courier New, monospace")
    	.attr("font-size", "10px")
    	.attr("text-anchor", "start")
    	.attr("fill", "white");

    width = (width + margin.left + margin.right) - 
			(margin.left + margin.right) * widget.retx.length;
	height = (height + margin.top + margin.bottom) - 
			(margin.top + margin.bottom) * widget.rety.length;

    widget.x = d3.scaleUtc().range([0, width / widget.retx.length]);
    widget.y = d3.scaleLinear().range([height / widget.rety.length, 0]);

    widget.xAxis = d3.axisBottom(widget.x)
    	.tickSize(-height / widget.rety.length);
    	

    widget.yAxis = d3.axisLeft(widget.y)
    	.ticks(3)
        .tickFormat(d3.format(opts.numformat))
        .tickSize(-(width / widget.retx.length)-3);

    //Zoom
    widget.x_new = widget.x;
    widget.zoom=d3.zoom()
    	.extent([[0, 0], [width, height]])
        .on('zoom', function(){
        	var t = d3.event.transform;
        	widget.x_new = t.rescaleX(widget.x);
        	Object.keys(widget.gX).map(function(i){
        		Object.keys(widget.gX[i]).map(function(j){
        			widget.gX[i][j].call(widget.xAxis.scale(widget.x_new));
        		});
        	});
        	if(widget.brushtime !== undefined){
        		Object.keys(widget.gbrush).map(function(i){
        			Object.keys(widget.gbrush[i]).map(function(j){
        				widget.brush.move(widget.gbrush[i][j], widget.brushtime.map(widget.x_new));
        			});
        		});
        		// widget.brush.move(widget.gbrush, widget.brushtime.map(widget.x_new));
        	}
            widget.redraw(widget.lastres);
        })
        .on('end', function(){
        	//update data
        	widget.update();
            widget.updateCallback(widget._encodeArgs());
        });

    //Brush and Brushsnapping
    var bsfunc = [d3.utcHour, d3.utcDay, d3.utcWeek, d3.utcMonth, d3.utcYear];
    var brushsnap = 0;

    widget.brush = d3.brushX()
		.extent([[0, 0], [width, height]])
		.on("end", function(){
			if(widget.iterating){
				widget.iterating = false;
				return;
			}
			if(!(d3.event.sourceEvent instanceof MouseEvent)) return;
			if(!d3.event.sourceEvent) return;
			if(!d3.event.selection){
				widget.brushtime = undefined;
				Object.keys(widget.gbrush).map(function(i){
	    			Object.keys(widget.gbrush[i]).map(function(j){
	    				widget.brush.move(widget.gbrush[i][j], null);
	    			});
	    		});
				widget.updateCallback(widget._encodeArgs());
				return;
			}
			var d0 = d3.event.selection.map(widget.x_new.invert);
			var d1 = d0.map(bsfunc[brushsnap].round);

			// If empty when rounded, use floor & cbexteil instead.
			if (d1[0] >= d1[1]) {
				d1[0] = bsfunc[brushsnap].floor(d0[0]);
				d1[1] = bsfunc[brushsnap].ceil(d0[1]);
			}
			widget.brushtime = d1;
			Object.keys(widget.gbrush).map(function(i){
    			Object.keys(widget.gbrush[i]).map(function(j){
    				widget.brush.move(widget.gbrush[i][j], d1.map(widget.x_new));
    			});
    		});
			// d3.event.target.move(widget.gbrush, d1.map(widget.x_new));
			widget.updateCallback(widget._encodeArgs());
		});

    // Timeline Left Pan button
    var arc = d3.symbol().type(d3.symbolDiamond)
    	.size([height] * 20);

	var leftpan = widget.midleft.append("svg")
		.attr("width", 30)
		.attr("height", height + margin.top + margin.bottom)
		.append('path')
		.attr('d', arc)
		.attr('fill', 'gray')
		.attr('stroke','#000')
		.attr('stroke-width',1)
		.attr('transform', 'translate(' + 30 + ',' + 
			(height + margin.top + margin.bottom)/2 + ')');
	
	var pan;
	leftpan.on("mouseover", function(){
		// console.log("Mouseover");
		leftpan.attr('fill', 'blue');
		pan = setInterval(function(){
			var transform = d3.zoomTransform(widget.anyts.node());
			widget.zoom.translateBy(widget.anyts, 20 / transform.k, 0);
        }, 10);
	});

	leftpan.on('mouseleave', function(){
		leftpan.attr('fill', 'gray');
		clearInterval(pan);
	});

	// Timeline svg
	widget.tssvg = {};
	widget.ts = {};
	widget.gX = {};
	widget.gY = {};
	widget.gbrush = {};
	for (var j in widget.rety){
		var rj = widget.rety[j];
		widget.tssvg[rj] = {};
		widget.ts[rj] = {};
		widget.gX[rj] = {};
		widget.gY[rj] = {};
		widget.gbrush[rj] = {};
		for (var i in widget.retx){
			var ri = widget.retx[i];
			widget.tssvg[rj][ri] = widget.timespace.append("svg")
				.attr("width", (width/widget.retx.length) + margin.left + margin.right)
        		.attr("height", (height/widget.rety.length) + margin.top + margin.bottom)
        		.attr("class", "tssvg");

        	widget.ts[rj][ri] = widget.tssvg[rj][ri].append("g")
        		.attr("transform", "translate(" + (margin.left) + "," +
		              (margin.top)+ ")")
		        .call(widget.zoom);

		    widget.gX[rj][ri] = widget.ts[rj][ri].append("g")
		        .attr("class", "axis axis--x")
		        .attr("transform", "translate(0," + (height/widget.rety.length) + ")")
		        .call(widget.xAxis);

		    widget.gY[rj][ri] = widget.ts[rj][ri].append("g")
		    	.attr("class", "axis axis--y")
		    	.call(widget.yAxis);

		    // margin.left = widget.ts[rj][ri].select('.axis--y').node().getBBox().width+3;
		    // console.log(margin.left);

		    widget.gbrush[rj][ri] = widget.ts[rj][ri].append("g")
		    	.attr("class", "brush")
		    	.call(widget.brush);
		}
	}

	Object.keys(widget.ts).map(function(i){
		Object.keys(widget.ts[i]).map(function(j){
			widget.ts[i][j].on("mousedown", function(){d3.event.stopPropagation();});
		});
	});

	widget.anygbrush = widget.getAny(widget.gbrush);
	widget.anyts = widget.getAny(widget.ts);

    // widget.tssvg = widget.midlayer.append("svg")
    //     .attr("width", width + margin.left + margin.right)
    //     .attr("height", height + margin.top + margin.bottom);
    // widget.ts = widget.tssvg.append("g")
    //     .attr("transform", "translate(" + margin.left + "," +
    //           margin.top + ")")
    //     .call(widget.zoom)
    //     .on("mousedown", function() { d3.event.stopPropagation(); });

    // Timeline Right Pan button

	var rightpan = widget.midright.append("svg")
		.attr("width", 30)
		.attr("height", height + margin.top + margin.bottom)
		.append('path')
		.attr('d', arc)
		.attr('fill', 'gray')
		.attr('stroke','#000')
		.attr('stroke-width',1)
		.attr('transform', 'translate(' + 0 + ',' + 
			(height + margin.top + margin.bottom)/2 + ')');
	
	var pan2;
	rightpan.on("mouseover", function(){
		rightpan.attr('fill', 'blue');
		pan2 = setInterval(function(){
            var transform = d3.zoomTransform(widget.anyts.node());
			widget.zoom.translateBy(widget.anyts, -20 / transform.k, 0);
        }, 10);
	});

	rightpan.on('mouseleave', function(){
		rightpan.attr('fill', 'gray');
		clearInterval(pan2);
	});

    if(opts.args){
    	widget._decodeArgs(opts.args);
    }
    else{
    	widget.x.domain(opts.timerange);
    }

    

    //Time Aggregation
    widget.unitTime = opts.binsec;

    widget.tatext = widget.botlayer.append("svg")
    	.attr("width", 250)
    	.attr("height", 30)
    	.attr("class", "tatext")
    	.append("text")
    	.attr("x", 10)
    	.attr("y", 15)
    	.attr("font-family", "sans-serif")
    	.attr("font-size", "12px")
    	.attr("text-anchor", "start")
    	.attr("fill", "white");

    widget.tapbtn = widget.botlayer.append('button')
        .attr('class', 'tap-btn')
        .on('click',function(){
            widget.tafactor = 1;
            widget.update();
        }).html("+");
    widget.tambtn = widget.botlayer.append('button')
        .attr('class', 'tam-btn')
        .on('click',function(){
            widget.tafactor = -1;
            widget.update();
        }).html("-");
    widget.tambtn = widget.botlayer.append('button')
        .attr('class', 'taa-btn')
        .on('click',function(){
            widget.tafactor = undefined;
            widget.update();
        }).html("auto");

    var rst = {
    	x_new: widget.x_new,
    	x: widget.x,
    	y: widget.y,
    	playstop: false,
    	ref: {},
    	currentstep: 0,
    	currentspeed: 0,
    	brushsnap: 0,
    	brushselection: null,
    	brushtime: undefined,
    	tainterval: null,
    	tafactor: undefined,
    	zoomtransform: d3.zoomTransform(widget.anyts.node())
    };

    widget.resetbtn = widget.botlayer.append('button')
    	.attr('class', 'rst-btn')
    	.on('click', function(){
    		play_stop = rst.playstop;
    		ref = rst.ref;
    		widget.x = rst.x;
    		widget.x_new = rst.x_new;
    		widget.y = rst.y;
    		currentstep = rst.currentstep;
    		currentspeed = rst.currentspeed;
    		brushsnap = rst.brushsnap;
    		widget.brushtime = rst.brushtime;
    		if(rst.tainterval !== null)
    			widget.interval = rst.tainterval;
    		widget.tafactor = rst.tafactor;
    		ashandle.attr("cx", asx(currentstep));
    		handle.attr("cx", sx(currentspeed));
    		bshandle.attr("cx", bsx(brushsnap));

    		widget.zoom.transform(widget.anyts, rst.zoomtransform);
    		Object.keys(widget.gbrush).map(function(i){
    			Object.keys(widget.gbrush[i]).map(function(j){
    				widget.brush.move(widget.gbrush[i][j], rst.brushselection);
    			});
    		});
    		

    		widget.update();
    		widget.playTime(play_stop, currentspeed, currentstep, ref);
    	}).html("Reset");

    widget.sdbtn = widget.botlayer.append('button')
    	.attr('class', 'rst-btn')
    	.on('click', function(){
    		rst.x_new = widget.x_new;
    		rst.x = widget.x;
    		rst.y = widget.y;
    		rst.playstop = play_stop;
    		rst.ref = ref;
    		rst.currentstep = currentstep;
    		rst.currentspeed = currentspeed;
    		rst.brushsnap = brushsnap;
    		// rst.brushselection = d3.brushSelection(widget.gbrush.node());
    		rst.brushtime = widget.brushtime;
    		rst.tainterval = widget.interval;
    		rst.tafactor = widget.tafactor;
    		// rst.zoomtransform = d3.zoomTransform(widget.ts.node());

    	}).html("Set default");

    widget.margin = margin;
    widget.width = width;
    widget.height = height;
    // widget.gX = gX;
    // widget.gY = gY;
    widget.iterating = false;
    widget.compare = false;
    

}

function arraysEqual(arr1, arr2) {
    if(arr1.length !== arr2.length)
        return false;
    for(var i = arr1.length; i--;) {
        if(arr1[i] !== arr2[i])
            return false;
    }

    return true;
}

Timeseries.prototype={
	update: function(){
        var widget = this;
        var sel = this.getSelection();
        var start = sel.global.start;
        var end = sel.global.end;

        if(widget.tafactor === undefined){
        	widget.interval = (end - start+1) / 1000 / this.width * 1;
        }
        else{
        	widget.interval = widget.interval * Math.pow(2, widget.tafactor);
        	if(widget.interval < widget.unitTime)
        		widget.interval = widget.unitTime;
        	widget.tafactor = 0;
        }

        //Round to nearest time unit
        var wi = widget.interval;
        if(Math.floor(wi / (3600 * 24 * 365)) > 0)
        	widget.interval = Math.floor(wi / (3600 * 24 * 365)) * (3600 * 24 * 365);
        else if(Math.floor(wi / (3600 * 24 * 7)) > 0)
        	widget.interval = Math.floor(wi / (3600 * 24 * 7)) * (3600 * 24 * 7);
        else if(Math.floor(wi / (3600 * 24)) > 0)
        	widget.interval = Math.floor(wi / (3600 * 24)) * (3600 * 24);
        else if(Math.floor(wi / 3600) > 0)
        	widget.interval = Math.floor(wi / 3600) * 3600;
        else if(Math.floor(wi / 60) > 0)
        	widget.interval = Math.floor(wi / 60) * 60;

        //updating time aggregation text

        widget.tatext.text(function(){
    		// console.log(widget.interval);
    		var bucketsize = widget.interval / widget.unitTime;
        	bucketsize = Math.max(1,Math.floor(bucketsize+0.5));

    		return "Unit Time: " + widget.timeUnit(widget.unitTime) + 
    			" Current time aggregation: " + 
    			widget.timeUnit(widget.unitTime * bucketsize);
    	});

    	var xydata = this.getXYCallback();
    	// console.log(xydata);
    	// console.log(this.retx, this.rety);

	    if(!arraysEqual(this.retx,xydata[0]) || !arraysEqual(this.rety,xydata[1])){
	    	console.log("Rebuilding..");

	    	if(widget.yext){
	    		widget.margin.left = widget.yext.toString().length * 3.5;
	    	}
	    	this.retx = xydata[0];
	    	this.rety = xydata[1];

	    	widget.width = (widget.width + widget.permleft + widget.margin.right) - 
	    					((widget.margin.left + widget.margin.right) * widget.retx.length);
	    	widget.height = (widget.height + widget.margin.top + widget.margin.bottom) - 
	    					((widget.margin.top + widget.margin.bottom) * widget.rety.length);
	    	widget.x.range([0, widget.width / widget.retx.length]);
	    	widget.x_new = widget.x;
		    widget.y.range([widget.height / widget.rety.length, 0]);

		    widget.xAxis = d3.axisBottom(widget.x)
		    	.tickSize(-(widget.height / widget.rety.length));
		    	

		    widget.yAxis = d3.axisLeft(widget.y)
		    	.ticks(3)
		        .tickFormat(d3.format(widget._opts.numformat))
		        .tickSize(-(widget.width / widget.retx.length));

	    	widget.timespace.selectAll("*").remove();
	    	widget.tssvg = {};
			widget.ts = {};
			widget.gX = {};
			widget.gY = {};
			widget.gbrush = {};
			// console.log(widget.retx, widget.rety);
			widget.zoom.extent([[0,0], [widget.width/widget.retx.length,
										widget.height/widget.rety.length]]);
			widget.brush.extent([[0,0], [widget.width/widget.retx.length,
										 widget.height/widget.rety.length]]);
			for (var j in widget.rety){
				var rj = widget.rety[j];
				widget.tssvg[rj] = {};
				widget.ts[rj] = {};
				widget.gX[rj] = {};
				widget.gY[rj] = {};
				widget.gbrush[rj] = {};
				for (var i in widget.retx){
					var ri = widget.retx[i];
					// console.log(ri);
					widget.tssvg[rj][ri] = widget.timespace.append("svg")
						.attr("width", (widget.width/widget.retx.length) + 
								widget.margin.left + widget.margin.right)
		        		.attr("height", (widget.height/widget.rety.length) +
		        					widget.margin.top + widget.margin.bottom)
		        		.attr("class", "tssvg");

		        	var xtext = widget.tssvg[rj][ri].append("text")
				    	.attr("x", (widget.margin.left + widget.margin.right + 
				    				widget.width/widget.retx.length) / 2)
				    	.attr("y", 10)
				    	.attr("font-family", "sans-serif")
				    	.attr("font-size", "10px")
				    	.attr("text-anchor", "end")
				    	.text("X COLOR    .");

				    if(ri != 'default')
				    	xtext.attr("fill", ri);
				    else
				    	xtext.attr("fill", "#ffffff");

				    var ytext = widget.tssvg[rj][ri].append("text")
				    	.attr("x", (widget.margin.left + widget.margin.right + 
				    				widget.width/widget.retx.length) / 2)
				    	.attr("y", 10)
				    	.attr("font-family", "sans-serif")
				    	.attr("font-size", "10px")
				    	.attr("text-anchor", "start")
				    	.text(".     Y COLOR");

				    if(rj != 'default')
				    	ytext.attr("fill", rj);
				    else
				    	ytext.attr("fill", "#ffffff");

		        	widget.ts[rj][ri] = widget.tssvg[rj][ri].append("g")
		        		.attr("transform", "translate(" + (widget.margin.left) + "," +
				              (widget.margin.top) + ")")
				        .call(widget.zoom);

				    widget.gX[rj][ri] = widget.ts[rj][ri].append("g")
				        .attr("class", "axis axis--x")
				        .attr("transform", "translate(0," + (widget.height/widget.rety.length) + ")")
				        .call(widget.xAxis);
				    // if(ri != "global")
				    // 	widget.gX[rj][ri].selectAll("path").style("stroke", ri);

				    widget.gY[rj][ri] = widget.ts[rj][ri].append("g")
				    	.attr("class", "axis axis--y")
				    	.call(widget.yAxis);


				    widget.gbrush[rj][ri] = widget.ts[rj][ri].append("g")
				    	.attr("class", "brush")
				    	.call(widget.brush);
				}
			}

			// console.log(widget.ts);

			Object.keys(widget.ts).map(function(a){
				Object.keys(widget.ts[a]).map(function(b){
					widget.ts[a][b].on("mousedown", function(){d3.event.stopPropagation();});
				});
			});

			widget.anygbrush = widget.getAny(widget.gbrush);
			widget.anyts = widget.getAny(widget.ts);
	    }

        var promises = {};

        //generate promise for each expr
        for (var d in widget._datasrc){
            if (widget._datasrc[d].disabled){
                continue;
            }
            var p;
            try{
            	p = this.getDataCallback(d,start, end, widget.interval);
            }
            catch(err){
            	console.log(err);
            	return;
            }
            for (var k in p){
                promises[k] = p[k];
            }
        }
            
        var promarray = Object.keys(promises).map(function(k){
            return promises[k];
        });

        // console.log(promises);

        var promkeys = Object.keys(promises);
        $.when.apply($,promarray).done(function(){
            var results = arguments;
            var res = {};
            Object.keys(widget.ts).map(function(a){
            	res[a] = {};
            	Object.keys(widget.ts[a]).map(function(b){
            		res[a][b] = {};
		            promkeys.forEach(function(d,i){
		                // res[d] = results[i];

		                var label = d.split('&-&');
		                var xyc = label[0].split('&');
		                var ret = {};
		                xyc.map(function(k){
		                    ret[k.charAt(0)] = k.substring(1);
		                });

		                //check ret.x, ret.y
		                if(ret.x != b && b != 'default')
		                	return;
		                if(ret.y != a && a != 'default')
		                	return;

		                if(ret.c){
		                	res[a][b][ret.c] = results[i];
		                	res[a][b][ret.c].color = ret.c;
		                }
		                else{
		                	res[a][b].global = results[i];
		                	var colormap = widget._datasrc[label[1]].colormap;
		                    var cidx = Math.floor(colormap.length/2);
		                    res[a][b].global.color = colormap[cidx];
		                }
		            });
            	});
            });

            // console.log(res);
            widget.lastres = res;
            widget.redraw(res);
            
        });

    },

    getSelection: function(){
        var sel = {};
        var timedom = this.x_new.domain();
        sel.global = {start:timedom[0], end:timedom[1]};

        widget = this;
        brushnode = this.anygbrush.node();
        if (brushnode !== null && d3.brushSelection(brushnode) !== null){
            var bext = d3.brushSelection(brushnode).map(this.x_new.invert);
            widget.bstext.text(function(){
				return "(" + bext[0].toUTCString() + ", " + bext[1].toUTCString() + ")";
			});
            sel.brush = {start:bext[0], end:bext[1]};
        }
        else{
        	widget.bstext.text("No Brush Selected");
        }
        return sel;
    },

    _encodeArgs: function(){
        var args= this.getSelection();
        return JSON.stringify(args);
    },
    
    _decodeArgs: function(s){
    	var widget = this;
        var args = JSON.parse(s);
        this.x.domain([new Date(args.global.start),
                       new Date(args.global.end)]);
        if(args.brush){
        	Object.keys(widget.gbrush).map(function(i){
        		Object.keys(widget.gbrush[i]).map(function(j){
        			widget.brush.move(widget.gbrush[i][j], 
		                            [widget.x(new Date(args.brush.start)),
		                             widget.x(new Date(args.brush.end))]);
        		});
        	});
            
        }
    },

    redraw: function(res){
    	// console.log(res);
    	Object.keys(res).map(function(i){
    		Object.keys(res[i]).map(function(j){
    			var lines = res[i][j];
    			var empty = true;
    			Object.keys(lines).forEach(function(k){
		            if(lines[k].data.length > 1){ 
		                var last = lines[k].data[lines[k].data.length-1];
		                lines[k].data.push(last); //dup the last point for step line
		                empty = false;
		            }
		            else{
		            	delete res[i][j][k];
		            }
		        });
		        if(empty)
		        	delete res[i][j];
    		});
    	});

    	//update y axis
    	var yext = Object.keys(res).reduce(function(p1,c1){
    		var g = Object.keys(res[c1]).reduce(function(p2,c2){
    			var f = Object.keys(res[c1][c2]).reduce(function(p3,c3){
    				var e = d3.extent(res[c1][c2][c3].data, function (d){
    					return (d.val || 0);
    				});
    				return [Math.min(p3[0],e[0]),
                     		Math.max(p3[1],e[1])];
    			}, [Infinity,-Infinity]);
    			return [Math.min(p2[0],f[0]),
                 		Math.max(p2[1],f[1])];
    		}, [Infinity,-Infinity]);
    		return [Math.min(p1[0],g[0]),
             		Math.max(p1[1],g[1])];	
    	}, [Infinity,-Infinity]);

        
        // var yext = Object.keys(lines).reduce(function(p,c){
        //     var e = d3.extent(lines[c].data, function(d){
        //         return (d.val || 0);
        //     });
        //     return [ Math.min(p[0],e[0]),
        //              Math.max(p[1],e[1])];
        // }, [Infinity,-Infinity]);


        yext[0]= yext[0]-0.05*(yext[1]-yext[0]); //show the line around min
        yext[0]= Math.min(yext[0],yext[1]*0.5);

        var widget = this;


        widget.yext = yext;

        widget.updateSVG();

        widget.x.range([0, widget.width / widget.retx.length]);
        widget.x_new.range([0, widget.width / widget.retx.length]);
		widget.y.range([widget.height / widget.rety.length, 0]);
		widget.y.domain(yext);


		widget.xAxis.scale(widget.x_new)
			.tickSize(-widget.height / widget.rety.length);
			
		widget.yAxis.scale(widget.y)
		    .tickSize(-(widget.width / widget.retx.length)-3);

        
        Object.keys(widget.ts).map(function(i){
        	Object.keys(widget.ts[i]).map(function(j){

        		//update the axis
        		widget.gX[i][j].call(widget.xAxis)
		        	.attr("transform", "translate(0," + (widget.height / widget.rety.length) + ")");
		        widget.gY[i][j].call(widget.yAxis);

		        widget.brush.extent([[0,0], [widget.width / widget.retx.length, 
		        							 widget.height/ widget.rety.length]]);
		        widget.gbrush[i][j].call(widget.brush);

		        if(widget.brushtime !== undefined){
		    		widget.brush.move(widget.gbrush[i][j], widget.brushtime.map(widget.x_new));
		    	}

		    	//Remove paths obsolete paths
		        var paths = widget.ts[i][j].selectAll('path.line');
		        paths.each(function(){
		            var p = this;
		            var exists;
		            if(res[i][j] === undefined)
		            	exists = false;
		            else{
			            exists = Object.keys(res[i][j]).some(function(d){
			                return d3.select(p).classed(d);
			            });
			        }
		            if (!exists){ // remove obsolete
		                d3.select(p).remove();
		            }
		        });

		        if(res[i][j] !== undefined){
		        	//Draw Lines
			        Object.keys(res[i][j]).forEach(function(k){
			        	// console.log(res[i][j][k].data);
			            res[i][j][k].data.sort(function(a,b){return a.time - b.time;});
			            widget.drawLine(res[i][j][k].data,res[i][j][k].color,i,j);
			        });
			    }


        	});
        });

        // console.log(d3.select('path'));
        
    },

    drawLine:function(data,color,i,j){
        var colorid = 'color_'+color.replace('#','');


        var widget = this;

        if (data.length < 2)
        	return;
        
        //create unexisted paths
        var path = widget.ts[i][j].select('path.line.'+colorid);

        if (path.empty()){
            path = widget.ts[i][j].append('path');
            path.attr('class', 'line '+colorid);
            
            path.style('stroke-width','2px')
                .style('fill','none')
                .style('stroke',color);
        }


        //Transit to new data
        var lineFunc = d3.line()
                .x(function(d) { return widget.x_new(d.time); })
                .y(function(d) { return widget.y(d.val); })
                .curve(d3.curveStepBefore);
        var zeroFunc = d3.line()
                .x(function(d) { return widget.x_new(d.time); })
                .y(function(d) { return widget.y(0); });

    	path.transition()
        	.duration(500)
        	.attr('d', lineFunc(data));

    },

    updateSVG: function(){

    	var widget = this;

    	var idwidth = parseFloat(d3.select(widget.toplayer.node().parentNode)
    		.style('width'));
    	var idheight = parseFloat(d3.select(widget.toplayer.node().parentNode)
    		.style('height'));
    	var width = idwidth - (this.margin.left + this.margin.right) * this.retx.length - 60;
    	var height;

    	if(idwidth < 1200){
    		widget.toplayer.style("height", 80 + "px");
    		height = idheight - ((this.margin.top + this.margin.bottom) * this.rety.length) - 110;
    	}
    	else{
    		widget.toplayer.style("height", 40 + "px");
    		height = idheight - ((this.margin.top + this.margin.bottom) * this.rety.length) - 70;
    	}

    	widget.toplayer.style("width", idwidth + "px");
    	widget.midlayer.style("width", idwidth + "px");
    	widget.midlayer.style("height", height +
    						((this.margin.top + this.margin.bottom) * this.rety.length) + "px");
    	widget.midleft.style("height", height +
    						((this.margin.top + this.margin.bottom) * this.rety.length) + "px");
    	widget.midright.style("height", height +
    						((this.margin.top + this.margin.bottom) * this.rety.length) + "px");
    	widget.timespace.style("width", idwidth - 60 + "px");
    	widget.timespace.style("height", height + 
    						((this.margin.top + this.margin.bottom) * this.rety.length) + "px");
    	widget.botlayer.style("width", idwidth + "px");

    	Object.keys(widget.tssvg).map(function(i){
    		Object.keys(widget.tssvg[i]).map(function(j){

    			widget.tssvg[i][j].attr("width", (width/widget.retx.length) + 
    									widget.margin.left + widget.margin.right);
    			widget.tssvg[i][j].attr("height", (height/widget.rety.length) + 
    									widget.margin.top + widget.margin.bottom);

    		});
    	});
    	
    	this.width = width;
    	this.height = height;
    },


    playTime: function(play_stop, speed, step, ref){
    	var widget = this;
    	if(play_stop){
    		widget.playbtn.html("Stop");
            if("repeat" in ref)
                clearInterval(ref.repeat);
            ref.repeat = setInterval(function(){
                widget.iterateTime(step, 1);
            }, (1000 - speed));

    	}
    	else{
    		widget.playbtn.html("Play");
            clearInterval(ref.repeat);
    	}
    },

    iterateTime: function(step, direction){
    	var bsel = d3.brushSelection(widget.anygbrush.node());
        if(bsel === null)
        	return;
        var asfunc = [d3.utcHour, d3.utcDay, d3.utcWeek, d3.utcMonth, d3.utcYear];
        var newbsel;
        if(step === 0){
        	var diff = bsel[1] - bsel[0];
        	newbsel = [bsel[0] + (diff * direction), bsel[1] + (diff * direction)];
        }
        else{
        	bseldate = bsel.map(widget.x_new.invert);
        	newbsel = [asfunc[step-1].offset(bseldate[0], direction),
        			   asfunc[step-1].offset(bseldate[1], direction)]
        			   .map(widget.x_new);
        }
        widget.iterating = true;
        widget.brushtime = newbsel.map(widget.x_new.invert);
        Object.keys(widget.gbrush).map(function(i){
        	Object.keys(widget.gbrush[i]).map(function(j){
        		widget.brush.move(widget.gbrush[i][j], newbsel);
        	});
        });
        
        widget.updateCallback(widget._encodeArgs());
    },

    timeUnit: function(t){
    	var unit = 's';
    	if((t % 60) === 0 && Math.floor(t / 60) > 0){
    		t = t / 60;
    		unit = 'm';
    		if((t % 60) === 0 && Math.floor(t / 60) > 0){
	    		t = t / 60;
	    		unit = 'h';
	    		if((t % 24) === 0 && Math.floor(t / 24) > 0){
					t = t / 24;
					unit = 'd';
					if((t % 365) === 0 && Math.floor(t / 365) > 0){
			    		t = t / 365;
			    		unit = 'y';
			    	}
					else if((t % 7) === 0 && Math.floor(t / 7) > 0){
			    		t = t / 7;
			    		unit = 'w';
			    	}
			    	
				}
	    	}
    	}
    	
    	return "" + t + unit;
    },

    getAny: function(obj){
    	var temp = obj[Object.keys(obj)[0]];
    	return temp[Object.keys(temp)[0]];
    },

    adjustToCompare: function(){
    	return;
    }

};

/*global d3 $ */
function RetinalBrushes(opts, updateCallback){
    this.updateCallback=updateCallback;

    var name=opts.name;
    var id = "#"+name.replace(/\./g,'\\.');

    var margin = {top: 20, right: 20, bottom: 20, left: 20};

    if(opts.args){
    	console.log(opts.args);
    	this._decodeArgs(opts.args);
    }

    var widget = this;
    //Make draggable and resizable
    d3.select(id).attr("class","retbrush resize-drag");

    this.coldrop = d3.select(id).append("div")
    	.attr("class", "retoptions dropzone")
    	.html("color");

    this.xdrop = d3.select(id).append("div")
    	.attr("class", "retoptions dropzone")
    	.html("x");

    this.ydrop = d3.select(id).append("div")
    	.attr("class", "retoptions dropzone")
    	.html("y");

    var labelNames = Object.keys(opts.model._widget);
    this.labels = labelNames.map(function(k, i){
    	var label = d3.select(id).append("div")
    		.style("width", k.length * 8 + "px")
	    	.style("height", 20 + "px")
	    	.style("left", ((i % 3) * 100  + 10) + "px")
	    	.style("top", (Math.floor(i / 4) * 25 + 50) + "px")
	    	.attr("class", "retlabels draggable")
	    	.html(k);

		return label;
    });

    this.retbrush = {
    	color:'',
    	x:'',
    	y:''
    };

    
    interact('.dropzone').dropzone({
        overlap: 0.51,
        ondrop: function(event) {
        	if(widget.retbrush[event.target.textContent] !== '')
        		return;
            event.relatedTarget.classList.add('dropped');
            widget.retbrush[event.target.textContent] = event.relatedTarget.textContent;
            widget.update();
        },
        ondragleave: function(event) {
        	if(widget.retbrush[event.target.textContent] !== event.relatedTarget.textContent)
        		return;
            event.relatedTarget.classList.remove('dropped');
            widget.retbrush[event.target.textContent] = '';
            widget.update();
        }
    });


}

RetinalBrushes.prototype={
	update: function(){
		var widget = this;
		// console.log(this.retbrush);
		this.updateCallback(widget._encodeArgs(), widget.retbrush);
	},

	getSelection: function(){
		return this.retbrush;
	},

	_encodeArgs: function(){
        var args= this.getSelection();
        return JSON.stringify(args);
    },
    
    _decodeArgs: function(s){
        var args = JSON.parse(s);
        this.retbrush = args;
    },
};

/*global $,d3 */

function Timeseries(opts,getDataCallback,updateCallback, getXYCallback){
    var id = '#'+ opts.name.replace(/\./g,'\\.');
    var widget = this;

    //Make draggable and resizable
    d3.select(id).attr("class","timeseries resize-drag"); //add resize-drag later

    d3.select(id).on("divresize",function(){
        widget.update();
    });

    this._opts = opts;

    var name = opts.name;

    opts.numformat = opts.numformat || ",";

    this._datasrc = opts.datasrc;

    widget.getDataCallback = getDataCallback;
    widget.updateCallback =  updateCallback;
    widget.getXYCallback = getXYCallback;

    this.retbrush = {
        color:'',
        x:'',
        y:''
    };

    this.retx = ['default'];
    this.rety = ['default'];

    var margin = opts.margin;
    if (margin === undefined)
        margin = {top: 10, right: 30, bottom: 20, left: 50};

    widget.permleft = margin.left;

    var width = $(id).width() - margin.left - margin.right - 60;
    var height = $(id).height() - margin.top - margin.bottom - 70;
                                    //30 from sliders above and below

    //Nested SVG layers
    widget.toplayer = d3.select(id).append("div")
        .style("width", $(id).width() + "px")
        .style("height", 40 + "px")
        .attr("class", "toplayer");

    widget.midlayer = d3.select(id).append("div")
        .style("width", $(id).width() + "px")
        .style("height", height + margin.top + margin.bottom + "px")
        .attr("class", "midlayer");

    widget.midleft = widget.midlayer.append("div")
        .style("width", 30)
        .style("height", height + margin.top + margin.bottom + "px")
        .attr("class", "midleft");

    widget.timespace = widget.midlayer.append("div")
        .style("width", width + margin.left + margin.right + "px")
        .style("height", height + margin.top + margin.bottom + "px")
        .attr("class", "timespace");

    widget.midright = widget.midlayer.append("div")
        .style("width", 30)
        .style("height", height + margin.top + margin.bottom + "px")
        .attr("class", "midright");

    widget.botlayer = d3.select(id).append("div")
        .style("width", $(id).width() + "px")
        .style("height", 30 + "px")
        .attr("class", "botlayer");


    //Animation step slider
    var asx = d3.scaleLinear()
        .domain([0, 5])
        .range([0, 200])
        .clamp(true);

    widget.asslider = widget.toplayer.append("svg")
        .attr("width", 250)
        .attr("height", 40)
        .attr("class", "as-slider")
        .append("g")
        .attr("transform", "translate(" + 25 + "," + 20 + ")");

    d3.select(widget.asslider.node().parentNode).append("text")
        .attr("x", 100)
        .attr("y", 12)
        .attr("font-family", "sans-serif")
        .attr("font-size", "10px")
        .attr("text-anchor", "center")
        .attr("fill", "white")
        .text("Animation Step");

    widget.asslider.append("line")
        .attr("class", "track")
        .attr("x1", asx.range()[0])
        .attr("x2", asx.range()[1])
    .select(function() { return this.parentNode.appendChild(this.cloneNode(true)); })
        .attr("class", "track-inset")
    .select(function() { return this.parentNode.appendChild(this.cloneNode(true)); })
        .attr("class", "track-overlay")
        .call(d3.drag()
            .on("start.interrupt", function(){widget.asslider.interrupt(); })
            .on("drag", function(){                                                                   
                var h = Math.round(asx.invert(d3.event.x));
                currentstep = h;
                ashandle.attr("cx", asx(h));
                widget.playTime(play_stop, currentspeed, h, ref);
            }));

    var aslist = ["Auto", "Hour", "Day", "Week", "Month", "Year"];
    widget.asslider.insert("g", ".track-overlay")
        .attr("class", "ticks")
        .attr("transform", "translate(0," + 18 + ")")
    .selectAll("text")
    .data([5, 4, 3, 2, 1, 0])
    .enter().append("text")
        .attr("x", asx)
        .attr("text-anchor", "middle")
        .attr("fill", "white")
        .text(function(d) { return aslist[d];});

    var ashandle = widget.asslider.insert("circle", ".track-overlay")
        .attr("class", "handle")
        .attr("r", 6);

    //Speed Slider
    var sx = d3.scaleLinear()
        .domain([0, 999])
        .range([0, 200])
        .clamp(true);

    widget.slider = widget.toplayer.append("svg")
        .attr("width", 250)
        .attr("height", 40)
        .attr("class", "spd-slider")
        .append("g")
        .attr("transform", "translate(" + 25 + "," + 20 + ")");

    d3.select(widget.slider.node().parentNode).append("text")
        .attr("x", 110)
        .attr("y", 12)
        .attr("font-family", "sans-serif")
        .attr("font-size", "10px")
        .attr("text-anchor", "center")
        .attr("fill", "white")
        .text("Speed");

    widget.slider.append("line")
        .attr("class", "track")
        .attr("x1", sx.range()[0])
        .attr("x2", sx.range()[1])
    .select(function() { return this.parentNode.appendChild(this.cloneNode(true)); })
        .attr("class", "track-inset")
    .select(function() { return this.parentNode.appendChild(this.cloneNode(true)); })
        .attr("class", "track-overlay")
        .call(d3.drag()
            .on("start.interrupt", function(){widget.slider.interrupt(); })
            .on("drag", function(){                                                            
                var h = sx.invert(d3.event.x);
                currentspeed = h;
                handle.attr("cx", sx(h));
                widget.playTime(play_stop, h, currentstep, ref);
            }));

    widget.slider.insert("g", ".track-overlay")
        .attr("class", "ticks")
        .attr("transform", "translate(0," + 18 + ")")
    .selectAll("text")
    .data([999, 800, 600, 400, 200, 0])
    .enter().append("text")
        .attr("x", sx)
        .attr("text-anchor", "middle")
        .attr("fill", "white")
        .text(function(d) { return (1000 - d) + " ms";});

    var handle = widget.slider.insert("circle", ".track-overlay")
        .attr("class", "handle")
        .attr("r", 6);

    //Brush play button
    var play_stop = false;
    var ref = {};
    var currentspeed = 0;
    var currentstep = 0;

    this.forwardbtn = widget.toplayer.append('button')
        .attr('class', 'play-btn')
        .on('click',function(){
            //iterates current color brush
            var curcolor = widget.brushcolors[widget.currentcolor];

            if(d3.brushSelection(widget.anygbrush[curcolor].node()) !== null){
                widget.iterateTime(currentstep, 1);
            }
        }).html(">");

    this.playbtn = widget.toplayer.append('button')
        .attr('class', 'play-btn')
        .on('click',function(){
            var curcolor = widget.brushcolors[widget.currentcolor];
            if(d3.brushSelection(widget.anygbrush[curcolor].node()) !== null){
                play_stop = !play_stop;
                widget.playTime(play_stop, currentspeed, currentstep, ref);
            }
        }).html("Play");

    this.backbtn = widget.toplayer.append('button')
        .attr('class', 'play-btn')
        .on('click',function(){
            var curcolor = widget.brushcolors[widget.currentcolor];
            if(d3.brushSelection(widget.anygbrush[curcolor].node()) !== null){
                widget.iterateTime(currentstep, -1);
            }
        }).html("<");

    //Brush snapping slider
    var bslist = ["Hour", "Day", "Week", "Month", "Year"];

    var bsx = d3.scaleLinear()
        .domain([0, 4])
        .range([0, 150])
        .clamp(true);

    widget.bsslider = widget.toplayer.append("svg")
        .attr("width", 200)
        .attr("height", 40)
        .append("g")
        .attr("class", "slider")
        .attr("transform", "translate(" + 25 + "," + 20 + ")");

    d3.select(widget.bsslider.node().parentNode).append("text")
        .attr("x", 75)
        .attr("y", 12)
        .attr("font-family", "sans-serif")
        .attr("font-size", "10px")
        .attr("text-anchor", "center")
        .attr("fill", "white")
        .text("Snap-to-grid");


    widget.bsslider.append("line")
        .attr("class", "track")
        .attr("x1", bsx.range()[0])
        .attr("x2", bsx.range()[1])
    .select(function() { return this.parentNode.appendChild(this.cloneNode(true)); })
        .attr("class", "track-inset")
    .select(function() { return this.parentNode.appendChild(this.cloneNode(true)); })
        .attr("class", "track-overlay")
        .call(d3.drag()
            .on("start.interrupt", function(){widget.bsslider.interrupt(); })
            .on("drag", function(){                                                                       
                var h = Math.round(bsx.invert(d3.event.x));
                brushsnap = h;
                bshandle.attr("cx", bsx(h));
            }));

    widget.bsslider.insert("g", ".track-overlay")
        .attr("class", "ticks")
        .attr("transform", "translate(0," + 18 + ")")
    .selectAll("text")
    .data([4, 3, 2, 1, 0])
    .enter().append("text")
        .attr("x", bsx)
        .attr("text-anchor", "middle")
        .attr("fill", "white")
        .text(function(d) { return bslist[d];});

    var bshandle = widget.bsslider.insert("circle", ".track-overlay")
        .attr("class", "handle")
        .attr("r", 6);

    //Brush Selection Text
    widget.bstextsvg = widget.toplayer.append("svg")
        .attr("width", 400)
        .attr("height", 30);

    widget.bstext = widget.bstextsvg.append("text")
        .attr("x", 10)
        .attr("y", 15)
        .text("No Brush Selected")
        .attr("font-family", "Courier New, monospace")
        .attr("font-size", "10px")
        .attr("text-anchor", "start")
        .attr("fill", "white");

    width = (width + margin.left + margin.right) - 
            (margin.left + margin.right) * widget.retx.length;
    height = (height + margin.top + margin.bottom) - 
            (margin.top + margin.bottom) * widget.rety.length;

    widget.x = d3.scaleUtc().range([0, width / widget.retx.length]);
    widget.y = d3.scaleLinear().range([height / widget.rety.length, 0]);

    widget.xAxis = d3.axisBottom(widget.x)
        .tickSize(-height / widget.rety.length);
        

    widget.yAxis = d3.axisLeft(widget.y)
        .ticks(3)
        .tickFormat(d3.format(opts.numformat))
        .tickSize(-(width / widget.retx.length)-3);

    //Zoom
    widget.x_new = widget.x;
    widget.zoom=d3.zoom()
        .extent([[0, 0], [width, height]])
        .on('zoom', function(){
            var t = d3.event.transform;
            widget.x_new = t.rescaleX(widget.x);
            Object.keys(widget.gX).map(function(i){
                Object.keys(widget.gX[i]).map(function(j){
                    widget.gX[i][j].call(widget.xAxis.scale(widget.x_new));
                });
            });

            Object.keys(widget.gbrush).map(function(i){
                Object.keys(widget.gbrush[i]).map(function(j){
                    Object.keys(widget.brushtime).map(function(color){
                        widget.brush[0].move(widget.gbrush[i][j][color],
                            widget.brushtime[color].map(widget.x_new));
                    });
                });
            });

            widget.redraw(widget.lastres);
        })
        .on('end', function(){
            //update data
            widget.update();
            widget.updateCallback(widget._encodeArgs());
        });

    //Brush and Brushsnapping
    var bsfunc = [d3.utcHour, d3.utcDay, d3.utcWeek, d3.utcMonth, d3.utcYear];
    var brushsnap = 0;
    this.brushcolors = colorbrewer.Set1[5].slice(0).reverse(0);

    //BRUSH
    widget.brush = {};
    var col;
    for(col = 0; col < 5; col++){
        widget.brush[col] = d3.brushX()
            .extent([[0, 0], [width, height]])
            .on("end", brushend(col));
    }

    function brushend(bindex){
        return function(){
            // set brush for selected brush color
            var selcolor = widget.brushcolors[bindex];

            if(widget.iterating){
                widget.iterating = false;
                return;
            }
            if(!(d3.event.sourceEvent instanceof MouseEvent)) return;
            if(!d3.event.sourceEvent) return;
            if(!d3.event.selection){
                delete widget.brushtime[selcolor];
                Object.keys(widget.gbrush).map(function(i){
                    Object.keys(widget.gbrush[i]).map(function(j){
                        widget.brush[bindex].move(widget.gbrush[i][j][selcolor], null);
                    });
                });
                widget.updateCallback(widget._encodeArgs());
                return;
            }
            var d0 = d3.event.selection.map(widget.x_new.invert);
            var d1 = d0.map(bsfunc[brushsnap].round);

            // If empty when rounded, use floor & cbexteil instead.
            if (d1[0] >= d1[1]) {
                d1[0] = bsfunc[brushsnap].floor(d0[0]);
                d1[1] = bsfunc[brushsnap].ceil(d0[1]);
            }
            widget.brushtime[selcolor] = d1;
            Object.keys(widget.gbrush).map(function(i){
                Object.keys(widget.gbrush[i]).map(function(j){
                    widget.brush[bindex].move(widget.gbrush[i][j][selcolor], 
                                                d1.map(widget.x_new));
                });
            });
            widget.updateCallback(widget._encodeArgs());
        };
    }

    // Timeline Left Pan button
    var arc = d3.symbol().type(d3.symbolDiamond)
        .size([height] * 20);

    var leftpan = widget.midleft.append("svg")
        .attr("width", 30)
        .attr("height", height + margin.top + margin.bottom)
        .append('path')
        .attr('d', arc)
        .attr('fill', 'gray')
        .attr('stroke','#000')
        .attr('stroke-width',1)
        .attr('transform', 'translate(' + 30 + ',' + 
            (height + margin.top + margin.bottom)/2 + ')');
    
    var pan;
    leftpan.on("mouseover", function(){
        // console.log("Mouseover");
        leftpan.attr('fill', 'blue');
        pan = setInterval(function(){
            var transform = d3.zoomTransform(widget.anyts.node());
            widget.zoom.translateBy(widget.anyts, 20 / transform.k, 0);
        }, 10);
    });

    leftpan.on('mouseleave', function(){
        leftpan.attr('fill', 'gray');
        clearInterval(pan);
    });


    widget.brushnumber = 1;
    widget.currentcolor = 0;
    widget.brushtime = {};

    if(opts.args){
        widget._decodeArgs(opts.args);
    }
    else{
        widget.x.domain(opts.timerange);
    }

    // Timeline svg
    widget.tssvg = {};
    widget.ts = {};
    widget.gX = {};
    widget.gY = {};
    widget.gbrush = {};
    for (var j in widget.rety){
        var rj = widget.rety[j];
        widget.tssvg[rj] = {};
        widget.ts[rj] = {};
        widget.gX[rj] = {};
        widget.gY[rj] = {};
        widget.gbrush[rj] = {};
        for (var i in widget.retx){
            var ri = widget.retx[i];
            widget.tssvg[rj][ri] = widget.timespace.append("svg")
                .attr("width", (width/widget.retx.length) + margin.left + margin.right)
                .attr("height", (height/widget.rety.length) + margin.top + margin.bottom)
                .attr("class", "tssvg");

            widget.ts[rj][ri] = widget.tssvg[rj][ri].append("g")
                .attr("transform", "translate(" + (margin.left) + "," +
                      (margin.top)+ ")")
                .call(widget.zoom);

            widget.gX[rj][ri] = widget.ts[rj][ri].append("g")
                .attr("class", "axis axis--x")
                .attr("transform", "translate(0," + (height/widget.rety.length) + ")")
                .call(widget.xAxis);

            widget.gY[rj][ri] = widget.ts[rj][ri].append("g")
                .attr("class", "axis axis--y")
                .call(widget.yAxis);

            widget.gbrush[rj][ri] = {};

            for (col = 0; col < 5; col++){
                var curcol = this.brushcolors[col];
                widget.gbrush[rj][ri][curcol] = widget.ts[rj][ri]
                    .append("g")
                    .attr("class", "brush")
                    .call(widget.brush[col]);

                d3.select(widget.gbrush[rj][ri][curcol].node())
                    .select(".selection")
                    .attr("fill", curcol);
            }
            
        }
    }



    Object.keys(widget.ts).map(function(i){
        Object.keys(widget.ts[i]).map(function(j){
            widget.ts[i][j].on("mousedown", function(){d3.event.stopPropagation();});
        });
    });

    widget.anygbrush = widget.getAny(widget.gbrush);
    widget.anyts = widget.getAny(widget.ts);

    var rightpan = widget.midright.append("svg")
        .attr("width", 30)
        .attr("height", height + margin.top + margin.bottom)
        .append('path')
        .attr('d', arc)
        .attr('fill', 'gray')
        .attr('stroke','#000')
        .attr('stroke-width',1)
        .attr('transform', 'translate(' + 0 + ',' + 
            (height + margin.top + margin.bottom)/2 + ')');
    
    var pan2;
    rightpan.on("mouseover", function(){
        rightpan.attr('fill', 'blue');
        pan2 = setInterval(function(){
            var transform = d3.zoomTransform(widget.anyts.node());
            widget.zoom.translateBy(widget.anyts, -20 / transform.k, 0);
        }, 10);
    });

    rightpan.on('mouseleave', function(){
        rightpan.attr('fill', 'gray');
        clearInterval(pan2);
    });


    //Time Aggregation
    widget.unitTime = opts.binsec;

    widget.tatext = widget.botlayer.append("svg")
        .attr("width", 250)
        .attr("height", 30)
        .attr("class", "tatext")
        .append("text")
        .attr("x", 10)
        .attr("y", 15)
        .attr("font-family", "sans-serif")
        .attr("font-size", "12px")
        .attr("text-anchor", "start")
        .attr("fill", "white");

    widget.tapbtn = widget.botlayer.append('button')
        .attr('class', 'tap-btn')
        .on('click',function(){
            widget.tafactor = 1;
            widget.update();
        }).html("+");
    widget.tambtn = widget.botlayer.append('button')
        .attr('class', 'tam-btn')
        .on('click',function(){
            widget.tafactor = -1;
            widget.update();
        }).html("-");
    widget.tambtn = widget.botlayer.append('button')
        .attr('class', 'taa-btn')
        .on('click',function(){
            widget.tafactor = undefined;
            widget.update();
        }).html("auto");


    widget.brushbtn = {};
    for(col = 0; col < 5; col++){
        widget.brushbtn[col] = widget.botlayer.append('button')
            .attr('id',(name + col + 'brush'))
            .on('click', brushPEToggle(col))
            .html("Brush " + (col + 1));
        $('#' + name + col + 'brush').css('color', widget.brushcolors[col]);
        if(col > widget.brushnumber - 1){
            $('#' + name + col + 'brush').hide();
        }
    }

    widget.brushbtn[0].attr('class', 'clicked');
    $('#' + name + 0 + 'brush').click();

    function brushPEToggle(index){
        return function(){
            $('#' + name + index + 'brush').toggleClass('clicked');
            $('#' + name + widget.currentcolor + 'brush').toggleClass('clicked');
            widget.currentcolor = index;
            // for(var brushnum = 0; brushnum < 5; brushnum++){
            //     if(brushnum == index){
            //         widget.brush[brushnum].selectAll('.overlay')
            //             .style('pointer-events', 'all');
            //     }
            //     else{
            //         widget.brush[brushnum].selectAll('.overlay')
            //             .style('pointer-events', 'none');
            //     }
            // }

            Object.keys(widget.gbrush).map(function(i){
                Object.keys(widget.gbrush[i]).map(function(j){
                    for(var brushnum = 0; brushnum < 5; brushnum++){
                        var brushnode = widget.gbrush[i][j][widget.brushcolors[brushnum]].node();
                        if(brushnum == index){
                            console.log(brushnode);
                            d3.select(brushnode)
                                .selectAll('.overlay')
                                .attr('pointer-events', 'all');
                            var firstchild = brushnode.parentNode.children[2];
                            brushnode.parentNode.insertBefore(brushnode, firstchild);
                        }
                        else{
                            d3.select(brushnode)
                                .selectAll('.overlay')
                                .attr('pointer-events', 'none');
                        }
                    }
                });
            });
            widget.updateCallback(widget._encodeArgs());
        };
    }

    widget.newbrushbtn = widget.botlayer.append('button')
        .attr('class', 'newbrush-btn')
        .on('click', function(){
            if(widget.brushnumber == 5) return;
            $('#' + name + widget.brushnumber + 'brush').show();
            $('#' + name + widget.brushnumber + 'brush').click();
            // widget.currentcolor = brushnumber;
            widget.brushnumber += 1;
            widget.updateCallback(widget._encodeArgs());
        }).html("New Brush");

    widget.delbrushbtn = widget.botlayer.append('button')
        .attr('class', 'delbrush-btn')
        .on('click', function(){
            if(widget.brushnumber == 1) return;

            widget.brushnumber -= 1;
            $('#' + name + widget.brushnumber + 'brush').hide();

            //move brush[brushcolor] to null

            var lastbrush = widget.brushcolors[widget.brushnumber];

            delete widget.brushtime[lastbrush];
            Object.keys(widget.gbrush).map(function(i){
                Object.keys(widget.gbrush[i]).map(function(j){
                    widget.brush[widget.brushnumber].move(widget.gbrush[i][j][lastbrush], null);
                });
            });
            if(widget.brushnumber == widget.currentcolor){
                $('#' + name + (widget.brushnumber - 1) + 'brush').click();
            }
            widget.updateCallback(widget._encodeArgs());
        }).html("Del Brush");

    widget.margin = margin;
    widget.width = width;
    widget.height = height;
    // widget.gX = gX;
    // widget.gY = gY;
    widget.iterating = false;
    widget.compare = false;
    widget.name = name;
    widget.update();
}


Timeseries.brushcolors = colorbrewer.Set1[5].slice(0).reverse(0);

function arraysEqual(arr1, arr2) {
    if(arr1.length !== arr2.length)
        return false;
    for(var i = arr1.length; i--;) {
        if(arr1[i] !== arr2[i])
            return false;
    }

    return true;
}

Timeseries.prototype={
    update: function(){
        var widget = this;
        var sel = this.getSelection();
        var start = sel.global.start;
        var end = sel.global.end;

        if(widget.tafactor === undefined){
            widget.interval = (end - start+1) / 1000 / this.width * 1;
        }
        else{
            widget.interval = widget.interval * Math.pow(2, widget.tafactor);
            if(widget.interval < widget.unitTime)
                widget.interval = widget.unitTime;
            widget.tafactor = 0;
        }

        //Round to nearest time unit
        var wi = widget.interval;
        if(Math.floor(wi / (3600 * 24 * 365)) > 0)
            widget.interval = Math.floor(wi / (3600 * 24 * 365)) * (3600 * 24 * 365);
        else if(Math.floor(wi / (3600 * 24 * 7)) > 0)
            widget.interval = Math.floor(wi / (3600 * 24 * 7)) * (3600 * 24 * 7);
        else if(Math.floor(wi / (3600 * 24)) > 0)
            widget.interval = Math.floor(wi / (3600 * 24)) * (3600 * 24);
        else if(Math.floor(wi / 3600) > 0)
            widget.interval = Math.floor(wi / 3600) * 3600;
        else if(Math.floor(wi / 60) > 0)
            widget.interval = Math.floor(wi / 60) * 60;

        //updating time aggregation text

        widget.tatext.text(function(){
            // console.log(widget.interval);
            var bucketsize = widget.interval / widget.unitTime;
            bucketsize = Math.max(1,Math.floor(bucketsize+0.5));

            return "Unit Time: " + widget.timeUnit(widget.unitTime) + 
                " Current time aggregation: " + 
                widget.timeUnit(widget.unitTime * bucketsize);
        });

        var xydata = this.getXYCallback();
        // console.log(xydata);
        // console.log(this.retx, this.rety);

        if(!arraysEqual(this.retx,xydata[0]) || !arraysEqual(this.rety,xydata[1])){
            console.log("Rebuilding..");

            if(widget.yext){
                widget.margin.left = widget.yext.toString().length * 3.5;
            }
            this.retx = xydata[0];
            this.rety = xydata[1];

            widget.width = (widget.width + widget.permleft + widget.margin.right) - 
                            ((widget.margin.left + widget.margin.right) * widget.retx.length);
            widget.height = (widget.height + widget.margin.top + widget.margin.bottom) - 
                            ((widget.margin.top + widget.margin.bottom) * widget.rety.length);
            widget.x.range([0, widget.width / widget.retx.length]);
            widget.x_new = widget.x;
            widget.y.range([widget.height / widget.rety.length, 0]);

            widget.xAxis = d3.axisBottom(widget.x)
                .tickSize(-(widget.height / widget.rety.length));
                

            widget.yAxis = d3.axisLeft(widget.y)
                .ticks(3)
                .tickFormat(d3.format(widget._opts.numformat))
                .tickSize(-(widget.width / widget.retx.length));

            widget.timespace.selectAll("*").remove();
            widget.tssvg = {};
            widget.ts = {};
            widget.gX = {};
            widget.gY = {};
            widget.gbrush = {};
            widget.zoom.extent([[0,0], [widget.width/widget.retx.length,
                                        widget.height/widget.rety.length]]);
            for(var col = 0; col < 5; col++){
                widget.brush[col].extent([[0,0], [widget.width/widget.retx.length, 
                                                widget.height/widget.rety.length]]);
            }
            
            for (var j in widget.rety){
                var rj = widget.rety[j];
                widget.tssvg[rj] = {};
                widget.ts[rj] = {};
                widget.gX[rj] = {};
                widget.gY[rj] = {};
                widget.gbrush[rj] = {};
                for (var i in widget.retx){
                    var ri = widget.retx[i];
                    // console.log(ri);
                    widget.tssvg[rj][ri] = widget.timespace.append("svg")
                        .attr("width", (widget.width/widget.retx.length) + 
                                widget.margin.left + widget.margin.right)
                        .attr("height", (widget.height/widget.rety.length) +
                                    widget.margin.top + widget.margin.bottom)
                        .attr("class", "tssvg");

                    var xtext = widget.tssvg[rj][ri].append("text")
                        .attr("x", (widget.margin.left + widget.margin.right + 
                                    widget.width/widget.retx.length) / 2)
                        .attr("y", 10)
                        .attr("font-family", "sans-serif")
                        .attr("font-size", "10px")
                        .attr("text-anchor", "end")
                        .text("X COLOR    .");

                    if(ri != 'default')
                        xtext.attr("fill", ri);
                    else
                        xtext.attr("fill", "#ffffff");

                    var ytext = widget.tssvg[rj][ri].append("text")
                        .attr("x", (widget.margin.left + widget.margin.right + 
                                    widget.width/widget.retx.length) / 2)
                        .attr("y", 10)
                        .attr("font-family", "sans-serif")
                        .attr("font-size", "10px")
                        .attr("text-anchor", "start")
                        .text(".     Y COLOR");

                    if(rj != 'default')
                        ytext.attr("fill", rj);
                    else
                        ytext.attr("fill", "#ffffff");

                    widget.ts[rj][ri] = widget.tssvg[rj][ri].append("g")
                        .attr("transform", "translate(" + (widget.margin.left) + "," +
                              (widget.margin.top) + ")")
                        .call(widget.zoom);

                    widget.gX[rj][ri] = widget.ts[rj][ri].append("g")
                        .attr("class", "axis axis--x")
                        .attr("transform", "translate(0," + (widget.height/widget.rety.length) + ")")
                        .call(widget.xAxis);

                    widget.gY[rj][ri] = widget.ts[rj][ri].append("g")
                        .attr("class", "axis axis--y")
                        .call(widget.yAxis);

                    widget.gbrush[rj][ri] = {};

                    for (col = 0; col < 5; col++){
                        var curcol = widget.brushcolors[col];
                        widget.gbrush[rj][ri][curcol] = widget.ts[rj][ri]
                            .append("g")
                            .attr("class", "brush")
                            .call(widget.brush[col]);

                        d3.select(widget.gbrush[rj][ri][curcol].node())
                            .select(".selection")
                            .attr("fill", curcol);
                    }

                }
            }

            $('#' + widget.name + widget.currentcolor + 'brush').click();

            Object.keys(widget.ts).map(function(a){
                Object.keys(widget.ts[a]).map(function(b){
                    widget.ts[a][b].on("mousedown", function(){d3.event.stopPropagation();});
                });
            });

            widget.anygbrush = widget.getAny(widget.gbrush);
            widget.anyts = widget.getAny(widget.ts);
        }

        var promises = {};

        //generate promise for each expr
        for (var d in widget._datasrc){
            if (widget._datasrc[d].disabled){
                continue;
            }
            var p;
            try{
                p = this.getDataCallback(d,start, end, widget.interval);
            }
            catch(err){
                console.log(err);
                return;
            }
            for (var k in p){
                promises[k] = p[k];
            }
        }
            
        var promarray = Object.keys(promises).map(function(k){
            return promises[k];
        });

        // console.log(promises);

        var promkeys = Object.keys(promises);
        $.when.apply($,promarray).done(function(){
            var results = arguments;
            var res = {};
            Object.keys(widget.ts).map(function(a){
                res[a] = {};
                Object.keys(widget.ts[a]).map(function(b){
                    res[a][b] = {};
                    promkeys.forEach(function(d,i){
                        // res[d] = results[i];

                        var label = d.split('&-&');
                        var xyc = label[0].split('&');
                        var ret = {};
                        xyc.map(function(k){
                            ret[k.charAt(0)] = k.substring(1);
                        });

                        //check ret.x, ret.y
                        if(ret.x != b && b != 'default')
                            return;
                        if(ret.y != a && a != 'default')
                            return;

                        if(ret.c){
                            res[a][b][ret.c] = results[i];
                            res[a][b][ret.c].color = ret.c;
                        }
                        else{
                            res[a][b].global = results[i];
                            var colormap = widget._datasrc[label[1]].colormap;
                            var cidx = Math.floor(colormap.length/2);
                            res[a][b].global.color = colormap[cidx];
                        }
                    });
                });
            });

            // console.log(res);
            widget.lastres = res;
            widget.redraw(res);
            
        });

    },

    getSelection: function(){
        var sel = {};
        var timedom = this.x_new.domain();
        sel.global = {start:timedom[0], end:timedom[1]};
        var curcolor = this.brushcolors[this.currentcolor];

        var widget = this;
        for(var i = 0; i < widget.brushnumber; i++){
            var selcolor = this.brushcolors[i];
            var brushnode = this.anygbrush[selcolor].node();
            if (brushnode !== null && d3.brushSelection(brushnode) !== null){
                var bext = d3.brushSelection(brushnode).map(this.x_new.invert);
                if(i == widget.currentcolor){
                    widget.bstext.text("(" + bext[0].toUTCString() + ", " + 
                        bext[1].toUTCString() + ")");
                }
                sel[selcolor] = {start:bext[0], end:bext[1]};
            }
            else{
                if(i == widget.currentcolor){
                    widget.bstext.text("No Brush Selected");
                }
                // sel[selcolor] = undefined;
            }
        }

        if(sel.hasOwnProperty(curcolor))
            sel.brush = sel[curcolor];
        else
            sel.brush = sel.global;

        return sel;
    },

    _encodeArgs: function(){
        var args = this.getSelection();
        Object.keys(args).map(function(color){
            if(color.startsWith("#")){
                args[color.substr(1)] = {start: args[color].start,
                                         end: args[color].end};
                delete args[color];
            }
        });
        return JSON.stringify(args);
    },
    
    _decodeArgs: function(s){
        
        var widget = this;
        console.log(s);
        var args = JSON.parse(s);
        this.x.domain([new Date(args.global.start),
                       new Date(args.global.end)]);

        var xydata = this.getXYCallback();
        widget.retx = xydata[0];
        widget.rety = xydata[1];

        var colors = Object.keys(args);

        for(var col = 0; col < 5; col++){
            var curcolor = widget.brushcolors[col];
            if(colors.indexOf(curcolor.substr(1)) != -1){
                widget.brushnumber = col + 1;
                widget.brushtime[curcolor] = [args[curcolor.substr(1)].start, 
                                              args[curcolor.substr(1)].end];
            }
        }

    },

    redraw: function(res){
        // console.log(res);
        Object.keys(res).map(function(i){
            Object.keys(res[i]).map(function(j){
                var lines = res[i][j];
                var empty = true;
                Object.keys(lines).forEach(function(k){
                    if(lines[k].data.length > 1){ 
                        var last = lines[k].data[lines[k].data.length-1];
                        lines[k].data.push(last); //dup the last point for step line
                        empty = false;
                    }
                    else{
                        delete res[i][j][k];
                    }
                });
                if(empty)
                    delete res[i][j];
            });
        });

        //update y axis
        var yext = Object.keys(res).reduce(function(p1,c1){
            var g = Object.keys(res[c1]).reduce(function(p2,c2){
                var f = Object.keys(res[c1][c2]).reduce(function(p3,c3){
                    var e = d3.extent(res[c1][c2][c3].data, function (d){
                        return (d.val || 0);
                    });
                    return [Math.min(p3[0],e[0]),
                            Math.max(p3[1],e[1])];
                }, [Infinity,-Infinity]);
                return [Math.min(p2[0],f[0]),
                        Math.max(p2[1],f[1])];
            }, [Infinity,-Infinity]);
            return [Math.min(p1[0],g[0]),
                    Math.max(p1[1],g[1])];  
        }, [Infinity,-Infinity]);

        
        // var yext = Object.keys(lines).reduce(function(p,c){
        //     var e = d3.extent(lines[c].data, function(d){
        //         return (d.val || 0);
        //     });
        //     return [ Math.min(p[0],e[0]),
        //              Math.max(p[1],e[1])];
        // }, [Infinity,-Infinity]);


        yext[0]= yext[0]-0.05*(yext[1]-yext[0]); //show the line around min
        yext[0]= Math.min(yext[0],yext[1]*0.5);

        var widget = this;


        widget.yext = yext;

        widget.updateSVG();

        widget.x.range([0, widget.width / widget.retx.length]);
        widget.x_new.range([0, widget.width / widget.retx.length]);
        widget.y.range([widget.height / widget.rety.length, 0]);
        widget.y.domain(yext);


        widget.xAxis.scale(widget.x_new)
            .tickSize(-widget.height / widget.rety.length);
            
        widget.yAxis.scale(widget.y)
            .tickSize(-(widget.width / widget.retx.length)-3);

        
        Object.keys(widget.ts).map(function(i){
            Object.keys(widget.ts[i]).map(function(j){

                //update the axis
                widget.gX[i][j].call(widget.xAxis)
                    .attr("transform", "translate(0," + 
                        (widget.height / widget.rety.length) + ")");
                widget.gY[i][j].call(widget.yAxis);

                for(k = 0; k < 5; k++){
                    var curcol = widget.brushcolors[k];
                    widget.brush[k].extent([[0,0], [widget.width / widget.retx.length, 
                                                 widget.height/ widget.rety.length]]);
                    widget.gbrush[i][j][curcol].call(widget.brush[k]);
                    if(widget.brushtime[curcol] !== undefined){
                        widget.brush[k].move(widget.gbrush[i][j][curcol], 
                                          widget.brushtime[curcol].map(widget.x_new));
                    }
                }

                //Remove paths obsolete paths
                var paths = widget.ts[i][j].selectAll('path.line');
                paths.each(function(){
                    var p = this;
                    var exists;
                    if(res[i][j] === undefined)
                        exists = false;
                    else{
                        exists = Object.keys(res[i][j]).some(function(d){
                            return d3.select(p).classed(d);
                        });
                    }
                    if (!exists){ // remove obsolete
                        d3.select(p).remove();
                    }
                });

                if(res[i][j] !== undefined){
                    //Draw Lines
                    Object.keys(res[i][j]).forEach(function(k){
                        res[i][j][k].data.sort(function(a,b){return a.time - b.time;});
                        widget.drawLine(res[i][j][k].data,res[i][j][k].color,i,j);
                    });
                }


            });
        });
        
    },

    drawLine:function(data,color,i,j){
        var colorid = 'color_'+color.replace('#','');


        var widget = this;

        if (data.length < 2)
            return;
        
        //create unexisted paths
        var path = widget.ts[i][j].select('path.line.'+colorid);

        if (path.empty()){
            path = widget.ts[i][j].append('path');
            path.attr('class', 'line '+colorid);

            path.style('stroke-width','2px')
                .style('fill','none')
                .style('stroke',color);
        }


        //Transit to new data
        var lineFunc = d3.line()
                .x(function(d) { return widget.x_new(d.time); })
                .y(function(d) { return widget.y(d.val); })
                .curve(d3.curveStepBefore);
        var zeroFunc = d3.line()
                .x(function(d) { return widget.x_new(d.time); })
                .y(function(d) { return widget.y(0); });

        path.transition()
            .duration(500)
            .attr('d', lineFunc(data));

    },

    updateSVG: function(){

        var widget = this;

        var idwidth = parseFloat(d3.select(widget.toplayer.node().parentNode)
            .style('width'));
        var idheight = parseFloat(d3.select(widget.toplayer.node().parentNode)
            .style('height'));
        var width = idwidth - (this.margin.left + this.margin.right) * this.retx.length - 60;
        var height;

        if(idwidth < 1200){
            widget.toplayer.style("height", 80 + "px");
            height = idheight - ((this.margin.top + this.margin.bottom) * this.rety.length) - 110;
        }
        else{
            widget.toplayer.style("height", 40 + "px");
            height = idheight - ((this.margin.top + this.margin.bottom) * this.rety.length) - 70;
        }

        widget.toplayer.style("width", idwidth + "px");
        widget.midlayer.style("width", idwidth + "px");
        widget.midlayer.style("height", height +
                            ((this.margin.top + this.margin.bottom) * this.rety.length) + "px");
        widget.midleft.style("height", height +
                            ((this.margin.top + this.margin.bottom) * this.rety.length) + "px");
        widget.midright.style("height", height +
                            ((this.margin.top + this.margin.bottom) * this.rety.length) + "px");
        widget.timespace.style("width", idwidth - 60 + "px");
        widget.timespace.style("height", height + 
                            ((this.margin.top + this.margin.bottom) * this.rety.length) + "px");
        widget.botlayer.style("width", idwidth + "px");

        Object.keys(widget.tssvg).map(function(i){
            Object.keys(widget.tssvg[i]).map(function(j){

                widget.tssvg[i][j].attr("width", (width/widget.retx.length) + 
                                        widget.margin.left + widget.margin.right);
                widget.tssvg[i][j].attr("height", (height/widget.rety.length) + 
                                        widget.margin.top + widget.margin.bottom);

            });
        });
        
        this.width = width;
        this.height = height;
    },


    playTime: function(play_stop, speed, step, ref){
        var widget = this;
        if(play_stop){
            widget.playbtn.html("Stop");
            if("repeat" in ref)
                clearInterval(ref.repeat);
            ref.repeat = setInterval(function(){
                widget.iterateTime(step, 1);
            }, (1000 - speed));
        }
        else{
            widget.playbtn.html("Play");
            clearInterval(ref.repeat);
        }
    },

    iterateTime: function(step, direction){
        var widget = this;
        var curcolor = widget.brushcolors[widget.currentcolor];
        var bsel = d3.brushSelection(widget.anygbrush[curcolor].node());
        if(bsel === null)
            return;
        var asfunc = [d3.utcHour, d3.utcDay, d3.utcWeek, d3.utcMonth, d3.utcYear];
        var newbsel;
        if(step === 0){
            var diff = bsel[1] - bsel[0];
            newbsel = [bsel[0] + (diff * direction), bsel[1] + (diff * direction)];
        }
        else{
            bseldate = bsel.map(widget.x_new.invert);
            newbsel = [asfunc[step-1].offset(bseldate[0], direction),
                       asfunc[step-1].offset(bseldate[1], direction)]
                       .map(widget.x_new);
        }
        widget.iterating = true;
        widget.brushtime[curcolor] = newbsel.map(widget.x_new.invert);
        Object.keys(widget.gbrush).map(function(i){
            Object.keys(widget.gbrush[i]).map(function(j){
                widget.brush[widget.currentcolor].move(widget.gbrush[i][j][curcolor], newbsel);
            });
        });
        
        widget.updateCallback(widget._encodeArgs());
    },

    timeUnit: function(t){
        var unit = 's';
        if((t % 60) === 0 && Math.floor(t / 60) > 0){
            t = t / 60;
            unit = 'm';
            if((t % 60) === 0 && Math.floor(t / 60) > 0){
                t = t / 60;
                unit = 'h';
                if((t % 24) === 0 && Math.floor(t / 24) > 0){
                    t = t / 24;
                    unit = 'd';
                    if((t % 365) === 0 && Math.floor(t / 365) > 0){
                        t = t / 365;
                        unit = 'y';
                    }
                    else if((t % 7) === 0 && Math.floor(t / 7) > 0){
                        t = t / 7;
                        unit = 'w';
                    }
                    
                }
            }
        }
        
        return "" + t + unit;
    },

    getAny: function(obj){
        var temp = obj[Object.keys(obj)[0]];
        return temp[Object.keys(temp)[0]];
    },

    adjustToCompare: function(){
        return;
    }

};




/*global $ d3 jsep colorbrewer Expression Map Timeseries GroupedBarChart */

var Viewer = function(opts){
    var container = $(opts.div_id);
    //set title
    if(opts.config.title){
        d3.select('head')
            .append('title')
            .html(opts.config.title);
    }
    
    //overlays
    var catdiv = $('<div>');
    catdiv.addClass('chart-overlay');
    catdiv.attr('id', 'cat_overlay');
    container.append(catdiv);
    
    var timediv = $('<div>');
    timediv.addClass('chart-overlay');
    timediv.attr('id', 'time_overlay');
    container.append(timediv);

    var retdiv = $('<div>');
    retdiv.addClass('chart-overlay');
    retdiv.attr('id', 'ret-overlay');
    container.append(retdiv);
    

    //setup
    var nanocubes = opts.nanocubes;
    var variables = [];
    
    this._container = container;
    this._catoverlay = catdiv;
    this._timeoverlay = timediv;
    this._retoverlay = retdiv;

    this._nanocubes = nanocubes;
    this._urlargs = opts.urlargs;
    this._widget = {};
    this._datasrc = opts.config.datasrc;
    var viewer = this;
    
    //Expressions input
    var datasrc = this._datasrc;
    for (var d in datasrc){
        var exp = datasrc[d].expr;
        var colormap = datasrc[d].colormap;
        var colormap2 = datasrc[d].colormap2;
        try{
            //make an expression
            datasrc[d].expr = new Expression(datasrc[d].expr);
            if(typeof colormap == 'string'){
                //make a copy of the colormap
                datasrc[d].colormap = colorbrewer[colormap][9].slice(0);
                datasrc[d].colormap.reverse();
            }
            if(typeof colormap2 == 'string'){
                //make a copy of the colormap
                datasrc[d].colormap2 = colorbrewer[colormap2][9].slice(0);
                datasrc[d].colormap2.reverse();
            }
        }
        catch(err){
            console.log('Cannot parse '+ exp + '--' + err);            
        }
    }

    //Setup each widget
    for (var w in opts.config.widget){
        viewer._widget[w] = viewer.setupWidget(w,opts.config.widget[w],
                                               opts.config.widget[w].levels);
    }

    var retwidget = {
        "type": 'ret', 
        "css": {
            "opacity": 0.8, 
            "height": "150px", 
            "width": "300px",
            "position": "absolute",
            "left": "50px",
            "top": "20px"
        }, 
        "title": "Retinal Brush"
    };

    viewer._widget.ret = viewer.setupWidget('ret', retwidget);

};


Viewer.prototype = {
    broadcastConstraint: function(skip,constraint){
        var widget=this._widget;
        for (var v in widget){
            if(skip.indexOf(v) == -1){
                if(widget[v].addConstraint){
                    widget[v].addConstraint(constraint);
                }
            }
        }
    },
    
    setupWidget:function(id, widget, levels){
        var options = $.extend(true, {}, widget);
        // console.log(typeof options);
        var viewer = this;
        
        options.name = id;
        options.model = viewer;
        options.args = viewer._urlargs[id] || null;
        options.datasrc = viewer._datasrc;

        //add the div
        var newdiv = $('<div>');
        newdiv.attr('id', id);
        newdiv.css(widget.css);

        // console.log(newdiv);
        
        //Create the widget
        switch(widget.type){
        case 'spatial':
            this._container.append(newdiv);
            options.levels = levels || 25;
            return new Map(options,function(datasrc,bbox,zoom,maptilesize){
                return viewer.getSpatialData(id,datasrc,bbox,zoom);
            },function(args,constraints,datasrc){
                return viewer.update([id, 'ret'],constraints,
                                     id,args,datasrc);
            },function(){
                return viewer.getXYData([id]);
            });
            
        case 'cat':
            options.compare = true;
            this._catoverlay.append(newdiv);
            return new GroupedBarChart(options,function(datasrc){
                return viewer.getCategoricalData(id,datasrc);
            },function(args,constraints){
                return viewer.update([id, 'ret'],constraints,
                                     id,args);
            },function(){
                return viewer.getXYData([id]);
            });
            
        case 'id':
            this._catoverlay.append(newdiv);
            return new GroupedBarChart(options, function(datasrc){
                return viewer.getTopKData(id,datasrc,options.topk);
            },function(args,constraints){
                return viewer.update([id, 'ret'],constraints,
                                     id,args);
            },function(){
                return viewer.getXYData([id]);
            });
            
        case 'time':
            this._timeoverlay.append(newdiv);
            options.timerange = viewer.getTimeRange();
            options.binsec = viewer.getBinTime();
            return new Timeseries(options,function(datasrc,start,end,interval){
                return viewer.getTemporalData(id,datasrc,start,end,interval);
            },function(args,constraints){
                return viewer.update([id, 'ret'],constraints,id,args);
            },function(){
                return viewer.getXYData([id]);
            });

        case 'ret':
            this._retoverlay.append(newdiv);
            return new RetinalBrushes(options, function(args,retbrush){
                return viewer.update([id],false,id,args,false,retbrush);
            });

        default:
            return null;
        }
    },
    
    setupDivs: function(config){
        for (var d in config){
            var newdiv = $('<div>');
            newdiv.attr('id', d);
            newdiv.css(config[d].div);
            this._container.append(newdiv);
        }
    },

    getTimeRange: function(){
        var nc = this._nanocubes;
        var range = Object.keys(nc).reduce(function(p,c){
            var s = nc[c].timeinfo.start;
            var e = nc[c].timeinfo.end;

            return [Math.min(p[0], nc[c].bucketToTime(s)),
                    Math.max(p[1], nc[c].bucketToTime(e))];
        }, [Infinity, 0]);
        return [new Date(range[0]), new Date(range[1])];
    },

    getBinTime: function(){
        var nc = this._nanocubes;
        var binsec = Object.keys(nc).map(function(c){
            return nc[c].timeinfo.bin_sec;
        });
        return binsec;
    },

    update: function(skip,constraints,name,args,datasrc,retbrush){
        // console.log("skip: ",skip);

        skip = skip || [];
        constraints = constraints || [];
        var viewer = this;

        //change datasrc configuration
        if(datasrc){
            for (var d in viewer._datasrc){
                viewer._datasrc[d].disabled = datasrc[d].disabled;
            }
        }

        if(retbrush){
            Object.keys(viewer._widget).forEach(function(d){
                if(skip.indexOf(d) == -1){
                    viewer._widget[d].retbrush = retbrush;
                }
            });
        }
        
        //update the url
        viewer.updateURL(name,args);

        //add constraints ....
        for (var c in constraints){
            viewer.broadcastConstraint(skip,constraints[c]);
        }

        Object.keys(viewer._widget).forEach(function(d){
            if (skip.indexOf(d) == -1){
                //re-render
                viewer._widget[d].update();
            }
        });
    },

    constructQuery: function(nc,skip){
        skip = skip || [];
        skip.push('ret');

        // console.log("skip: ",skip);

        var viewer = this;
        var queries = {};
        queries.global = nc.query();

        var retbrush;
        if(this._widget.ret)
            retbrush = this._widget.ret.getSelection();
        else{
            retbrush = {
                color:'',
                x:'',
                y:''
            };
        }
        var retarray = Object.keys(retbrush).map(function(k){
            return retbrush[k];
        });

        // console.log(Object.keys(this._widget));

        //brush
        Object.keys(this._widget).forEach(function(d){
            if (skip.indexOf(d) == -1 && retarray.indexOf(d) == -1){
                var sel = viewer._widget[d].getSelection();

                if(sel.brush){
                    queries.global=queries.global.setConstraint(d,sel.brush);
                }else if(sel.global){
                    queries.global=queries.global.setConstraint(d,sel.global);
                }

                              
            }
        });

        // console.log(retarray);
        var xqueries = {};
        var yqueries = {};
        var cqueries = {};
        
        //then the restTimeseries.prototype={
        Object.keys(this._widget).forEach(function(d){
            if (skip.indexOf(d) == -1 && retarray.indexOf(d) != -1){
                var sel = viewer._widget[d].getSelection();
                Object.keys(sel).filter(function(d){
                    return (d != 'brush') && (d != 'global');
                }).forEach(function(s){
                    //get an appropriate query
                    // var q = queries[s] || $.extend(true,{},queries.global);
                    
                    //add a constraint
                    if(retbrush.x == d)
                        xqueries[s] = [d, sel[s]];
                    else if (retbrush.y == d)
                        yqueries[s] = [d, sel[s]];
                    else //color
                        cqueries[s] = [d, sel[s]];
                });
            }
        });

        // console.log(retbrush);
        // console.log(xqueries, yqueries, cqueries);

        if(!jQuery.isEmptyObject(xqueries)){
            Object.keys(xqueries).forEach(function(s){
                var str1 = '&x' + s;
                var q1 = $.extend(true,{},queries.global);
                q1 = q1.setConstraint(xqueries[s][0], xqueries[s][1]);
                if(!jQuery.isEmptyObject(yqueries)){
                    Object.keys(yqueries).forEach(function(s){
                        var str2 = str1 + '&y' + s;
                        var q2 = $.extend(true,{},q1);
                        q2 = q2.setConstraint(yqueries[s][0], yqueries[s][1]);
                        if(!jQuery.isEmptyObject(cqueries)){
                            Object.keys(cqueries).forEach(function(s){
                                var str3 = str2 + '&c' + s;
                                var q3 = $.extend(true,{},q2);
                                queries[str3] = q3.setConstraint(cqueries[s][0], cqueries[s][1]); 
                            });
                        }
                        else{
                            queries[str2] = q2;
                        }
                    });
                }
                else{
                    if(!jQuery.isEmptyObject(cqueries)){
                        Object.keys(cqueries).forEach(function(s){
                            var str2 = str1 + '&c' + s;
                            var q2 = $.extend(true,{},q1);
                            queries[str2] = q2.setConstraint(cqueries[s][0], cqueries[s][1]); 
                        });
                    }
                    else{
                        queries[str1] = q1;
                    }
                }
            });
        }
        else{
            if(!jQuery.isEmptyObject(yqueries)){
                Object.keys(yqueries).forEach(function(s){
                    var str1 = '&y' + s;
                    var q1 = $.extend(true,{},queries.global);
                    q1 = q1.setConstraint(yqueries[s][0], yqueries[s][1]);
                    if(!jQuery.isEmptyObject(cqueries)){
                        Object.keys(cqueries).forEach(function(s){
                            var str2 = str1 + '&c' + s;
                            var q2 = $.extend(true,{},q1);
                            queries[str2] = q2.setConstraint(cqueries[s][0], cqueries[s][1]); 
                        });
                    }
                    else{
                        queries[str1] = q1;
                    }
                });
            }
            else{
                if(!jQuery.isEmptyObject(cqueries)){
                    Object.keys(cqueries).forEach(function(s){
                        var str1 = '&c' + s;
                        var q1 = $.extend(true,{},queries.global);
                        queries[str1] = q1.setConstraint(cqueries[s][0], cqueries[s][1]); 
                    });
                }
                else{
                    // console.log("Do nothing");
                }
            }
        }
        
        //console.log(queries.global,skip);

        
        if (Object.keys(queries).length > 1){
            delete queries.global;
        }

        return queries;
    },

    getXYData: function(skip){
        skip.push('ret');
        var retbrush;
        if(this._widget.ret)
            retbrush = this._widget.ret.getSelection();
        else{
            retbrush = {
                color:'',
                x:'',
                y:''
            };
        }
        var retarray = Object.keys(retbrush).map(function(k){
            return retbrush[k];
        });

        var x = [];
        var y = [];
        
        //then the restTimeseries.prototype={
        Object.keys(this._widget).forEach(function(d){
            if (skip.indexOf(d) == -1 && retarray.indexOf(d) != -1){
                var sel = viewer._widget[d].getSelection();
                Object.keys(sel).filter(function(d){
                    return (d != 'brush') && (d != 'global');
                }).forEach(function(s){
                    if(retbrush.x == d)
                        x.push(s);
                    else if (retbrush.y == d)
                        y.push(s);
                });
            }
        });
        if(y.length === 0)
            y = ['default'];
        if(x.length === 0)
            x = ['default'];
        return [x,y];
    },

    getSpatialData:function(varname, datasrc, bbox, zoom, maptilesize){
        var k = Object.keys(this._nanocubes);
        var viewer = this;

        //construct a list of queries
        var cq = {};
        k.forEach(function(d){
            var nc = viewer._nanocubes[d];
            cq[d]=viewer.constructQuery(nc,[varname]);
        });

        //organize the queries by selection
        var selq = {};
        Object.keys(cq).forEach(function(d){
            Object.keys(cq[d]).forEach(function(s){
                selq[s] = selq[s] || {};
                selq[s][d] = cq[d][s];
            });
        });

        //generate queries for each selections
        var res = {};
        var data = viewer._datasrc;
        var expr = data[datasrc].expr;
        Object.keys(selq).forEach(function(s){
            res[s+'&-&'+datasrc] = expr.getData(selq[s],function(q){
                return q.spatialQuery(varname,bbox,zoom,maptilesize);
            });
        });
        return res;
    },

    getTemporalData:function(varname,datasrc,start,end,intervalsec){
        var k = Object.keys(this._nanocubes);
        var viewer = this;

        //construct a list of queries
        var cq = {};
        k.forEach(function(d){
            var nc = viewer._nanocubes[d];
            cq[d]=viewer.constructQuery(nc,[varname]);
        });


        //organize the queries by selection
        var selq = {};
        Object.keys(cq).forEach(function(d){
            Object.keys(cq[d]).forEach(function(s){
                selq[s] = selq[s] || {};
                selq[s][d] = cq[d][s];
            });
        });

        //generate queries for each selections
        var res = {};        
        var data = viewer._datasrc;
        Object.keys(selq).forEach(function(s){            
            var expr = data[datasrc].expr;
            res[s+'&-&'+datasrc] = expr.getData(selq[s],function(q){
                return q.temporalQuery(varname,start,end,intervalsec);
            });
        });
        return res;
    },

    getTopKData:function(varname,datasrc,n){
        n = n || 20; // hard code test for now
        var k = Object.keys(this._nanocubes);
        var viewer = this;

        //construct a list of queries
        var cq = {};
        k.forEach(function(d){
            var nc = viewer._nanocubes[d];
            cq[d]=viewer.constructQuery(nc,[varname]);
        });

        //organize the queries by selection
        var selq = {};
        Object.keys(cq).forEach(function(d){
            Object.keys(cq[d]).forEach(function(s){
                selq[s] = selq[s] || {};
                selq[s][d] = cq[d][s];
            });
        });

        //generate queries for each selections
        var res = {};
        var data = viewer._datasrc;
        Object.keys(selq).forEach(function(s){
            var expr = data[datasrc].expr;
            res[s+'&-&'+datasrc] =expr.getData(selq[s],function(q){
                return q.topKQuery(varname,n);
            });
        });
        return res;
    },

    getCategoricalData:function(varname,datasrc){
        var k = Object.keys(this._nanocubes);
        var viewer = this;

        //construct a list of queries
        var cq = {};
        k.forEach(function(d){
            var nc = viewer._nanocubes[d];
            cq[d]=viewer.constructQuery(nc,[varname]);
        });

        //organize the queries by selection
        var selq = {};
        Object.keys(cq).forEach(function(d){
            Object.keys(cq[d]).forEach(function(s){
                selq[s] = selq[s] || {};
                selq[s][d] = cq[d][s];
            });
        });

        //generate queries for each selections
        var res = {};
        var data = viewer._datasrc;
        Object.keys(selq).forEach(function(s){
            var expr = data[datasrc].expr;
            res[s+'&-&'+datasrc] = expr.getData(selq[s],function(q){
                return q.categorialQuery(varname);
            });
        });
        return res;
    },
    
    updateURL: function(k,argstring){
        if(!k || !argstring){
            return;
        }

        var args = this._urlargs;
        args[k] = argstring;

        var res = Object.keys(args).map(function(k){
            return k+'='+args[k];
        });
        var argstr = '?'+ res.join('&');

        //change the url
        window.history.pushState('test','title',
                                 window.location.pathname+
                                 argstr);
    }
};

     Nanocube3.Nanocube = Nanocube;
     Nanocube3.Viewer = Viewer;
     return Nanocube3;
}));

//# sourceMappingURL=Nanocube.js.map