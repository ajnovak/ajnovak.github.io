(function(){

    //pseudo-global variables
    var attrArray = ["Built", "Air", "Land", "Water", "Sociodemographic", "Environmental Quality"]; //list of attributes
    var expressed = attrArray[0]; //initial attribute

    var chartWidth = window.innerWidth * 0.47,
    chartHeight = 473,
    leftPadding = 50,
    rightPadding = 2,
    topBottomPadding = 5,
    chartInnerWidth = chartWidth - leftPadding - rightPadding,
    chartInnerHeight = chartHeight - topBottomPadding * 2,
    translate = "translate(" + leftPadding + "," + topBottomPadding + ")";

//create a scale to size bars proportionally to frame and for axis
    var yScale = d3.scaleLinear()
    .range([463, 0])
    .domain([-2, 2]);

window.onload = setMap();



function setMap(){

    //map frame dimensions
    var width = window.innerWidth * 0.25,
        height = 500;

    //create new svg container for the map
    var map = d3.select("#map")
        .append("svg")
        .attr("class", "map")
        .attr("width", width)
        .attr("height", height);

    //create Albers equal area conic projection centered on Wisconsin
    var projection = d3.geoAlbers()

    .center([0, 44.75])
    .rotate([90, 0])
    .parallels([45, 46])
    .scale(5500)
    .translate([width / 2, height / 2]);

	var path = d3.geoPath()
        .projection(projection);
        
    //use Promise.all to parallelize asynchronous data loading
    var promises = [];    
    promises.push(d3.csv("data/EnvJust.csv")); //load attributes from csv    
    promises.push(d3.json("data/USA.topojson")); //load background spatial data    
    promises.push(d3.json("data/wiCounties.topojson")); //load choropleth spatial data    
    Promise.all(promises).then(callback);

    function callback(data) {
        var csvData = data[0],
            midwest = data[1],
            wi = data[2];

        var region = topojson.feature(midwest, midwest.objects.USA);
        counties= topojson.feature(wi, wi.objects.wiCounties).features;

    //add states  to map
    var states= map.append("path")
        .datum(region)
        .attr("class", "region")
        .attr("d", path);

        counties = joinData(counties, csvData);

        var colorScale = makeColorScale(csvData);

        setEnumerationUnits(counties, map, path, colorScale);

        //add coordinated visualization to the map
            setChart(csvData, colorScale);

            createDropdown(csvData);

            
    };

};

    function joinData(counties,csvData){
        
        for (var i=0; i<csvData.length; i++){
            var csvCounty = csvData[i]; 
            var csvKey = csvCounty.COUNTY_NAM;

            // loop through block groups to find correct region
            for (var a=0; a<counties.length; a++){
                var geojsonProps = counties[a].properties; // current geojson properties
                var geojsonKey = geojsonProps.COUNTY_NAM;
                
                // where keys match, transfer csv data to geojson properties object
                if (geojsonKey == csvKey){
                    attrArray.forEach(function(attr){
                        var val = parseFloat(csvCounty[attr]); // get csv attr value. parseFloat parses an arg and returns floating point number
                        geojsonProps[attr] = val;   // assign attr and value to geojson properties
                    });
                };
            };
        };
                
                return counties;

}



//function to create color scale generator
function makeColorScale(data){
    var colorClasses = [
    "#1a9850",
    "#91cf60",
    "#d9ef8b",
    "#fee08b",
    "#fc8d59",
    "#d73027",

    ];

    var colorClasses1 = [
        "#f7fcb9",
        "#addd8e",
        "#31a354",
    ];

    var colorClasses2 = [
        "#fff7bc",
        "#fec44f",
        "#d95f0e",
    ];




    //create color scale generator
        var colorScale = d3.scaleThreshold()
        .range(colorClasses);

    //build array of all values of the expressed attribute
    var domainArray = [];
    for (var i=0; i<data.length; i++){
        var val = parseFloat(data[i][expressed]);
        domainArray.push(val);
    };
    console.log(domainArray);
    //cluster data using ckmeans clustering algorithm to create natural breaks
    var clusters = ss.ckmeans(domainArray, 6);
    //reset domain array to cluster minimums
    domainArray = clusters.map(function(d){
        return d3.min(d);
    });
    //remove first value from domain array to create class breakpoints
    domainArray.shift();

    //assign array of last 4 cluster minimums as domain
    colorScale.domain(domainArray);

    return colorScale;
};

function setChart(csvData, colorScale){

    // create svg element fo hold bar chart
    var chart = d3.select("#chart")
        .append("svg")
        .attr("width", chartWidth)
        .attr("height", chartHeight)
        .attr("class", "chart");
    
        
    // create a rectangle for chart background fill
    var chartBackground = chart.append("rect")
        .attr("class", "chartBackground")
        .attr("width", chartInnerWidth)
        .attr("height", chartInnerHeight)
        .attr("transform", translate);


    
    var bars = chart.selectAll(".bar")
        .data(csvData)
        .enter()
        .append("rect")
        .sort(function(a, b){
            return b[expressed]-a[expressed]
        })
        .attr("class", function(d){
            return "bar " + d.COUNTY_NAM;
        })
        .attr("width", chartInnerWidth / csvData.length - 1)

        .on("mouseover", function(event, d){
            highlight(d);
        })
        .on("mouseout", function(event, d){
            dehighlight(d);
        })
        .on("mousemove", moveLabel);
    
    // create text element for chart title and add to chart
    var chartTitle = chart.append("text")
        .attr("x", 155)
        .attr("y", 20)
        .attr("class", "chartTitle")
        .text("Index of  " + expressed + " by County");
    
    // create vertical axis generator
    var yAxis = d3.axisLeft()
        .scale(yScale);

    // place axis
    var axis = chart.append("g")
        .attr("class", "axis")
        .attr("transform", translate)
        .call(yAxis);

    
    //create frame for chart border
    var chartFrame = chart.append("rect")
        .attr("class", "chartFrame")
        .attr("width", chartInnerWidth)
        .attr("height", chartInnerHeight)
        .attr("transform", translate);
    
    // add style descriptor to each rect
    var desc = bars.append("desc").text('{"stroke": "none", "stroke-width": "0px"}');

    updateChart(bars, csvData.length, colorScale);
};




function setEnumerationUnits(counties,map,path,colorScale){	
    //add WI counties to map  
    var regions = map.selectAll(".regions")        
        .data(counties)        
        .enter()        
        .append("path")        
        .attr("class", function(d){            
            return "regions " + d.properties.COUNTY_NAM;        
        })        
        .attr("d", path)        
            .style("fill", function(d){            
                var value = d.properties[expressed];            
                if(value) {            	
                    return colorScale(d.properties[expressed]);            
                } else {            	
                    return "#ccc";            
                }    
            })
            .on("mouseover", function(event, d){
                highlight(d.properties);
            })
            .on("mouseout", function(event, d){
                dehighlight(d.properties);
            })
            .on("mousemove", moveLabel);
        
        // add style descriptor to each path
        var desc = regions.append("desc").text('{"stroke": "#CCC", "stroke-width": "1px"}');
    };



function createDropdown(csvData){
    //add select element
    var dropdown = d3.select("body")
        .append("select")
        .attr("class", "dropdown")
        .on("change", function(){
            changeAttribute(this.value, csvData)
        });

    //add initial option
    var titleOption = dropdown.append("option")
        .attr("class", "titleOption")
        .attr("disabled", "true")
        .text("Select EQI Domain");

    //add attribute name options
    var attrOptions = dropdown.selectAll("attrOptions")
        .data(attrArray)
        .enter()
        .append("option")
        .attr("value", function(d){ return d })
        .text(function(d){ return d });

    };


//dropdown change event handler
function changeAttribute(attribute, csvData){
    //change the expressed attribute
    expressed = attribute;

    //recreate the color scale
    var colorScale = makeColorScale(csvData);

    //recolor enumeration units
    var regions2 = d3.selectAll(".regions")
            .transition()
            .duration(500) // milliseconds
            .style("fill", function (d) {
                    var value = d.properties[expressed];
                //console.log(value)
                if (value) {
                    return colorScale(d.properties[expressed]);
                } else {
                    return "#ccc";
                }
        });

//re-sort, resize, and recolor bars
    var bars = d3.selectAll(".bar")
        //re-sort bars
        .sort(function(a, b){
            return b[expressed] - a[expressed];
        })
        .transition() //add animation
        .delay(function(d, i){
            return i * 20
        })
        .duration(500);

    updateChart(bars, csvData.length, colorScale);


}




function updateChart(bars, n, colorScale){
    //position bars
    bars.attr("x", function(d, i){
            return i * (chartInnerWidth / n) + leftPadding;
        })
        //size/resize bars
        .attr("height", function(d, i){
            return 463 - yScale(parseFloat(d[expressed]));
        })
        .attr("y", function(d, i){
            return yScale(parseFloat(d[expressed])) + topBottomPadding;
        })
        //color/recolor bars
        .style("fill", function(d){
            var value = d[expressed];
            if(value) {
                return colorScale(value);
            } else {
                return "#ccc";
            }
    });

        //at the bottom of updateChart()...add text to chart title
    var chartTitle = d3.select(".chartTitle")
        .text("Index of " + expressed + " by County");
}        




function highlight(props){
    //console.log(props);

    // change stroke
    var selected = d3.selectAll("." + props.COUNTY_NAM)
        .style("stroke", "cyan")
        .style("stroke-width", "3");
        setLabel(props);
}

function dehighlight(props){
    var selected = d3.selectAll("." + props.COUNTY_NAM)
        .style("stroke", function(){
            return getStyle(this, "stroke")
        })
        .style("stroke-width", function(){
            return getStyle(this, "stroke-width")
        });

    function getStyle(element, styleName){
        var styleText = d3.select(element)
            .select("desc")
            .text();

        var styleObject = JSON.parse(styleText);

        return styleObject[styleName];
    };
    
    d3.select(".infolabel")
    .remove();
};


function setLabel(props){
    // create HTML string containing selected attrib value
    var labelAttribute = "<h1>" + props[expressed] + "</h1>";
    
    // create div element to hold information
    var infolabel = d3
        .select("body")
        .append("div")
        .attr("class", "infolabel")
        .attr("id", props.COUNTY_NAM + "_label")
        .html(labelAttribute);

    // add child div to contain name of selected block group
    var county = infolabel
        .append("div")
        .attr("class", "labelname")
        .html(props.COUNTY_NAM);
};


function moveLabel(){
    //get width of label
    var labelWidth = d3.select(".infolabel")
        .node()
        .getBoundingClientRect()
        .width;

    //use coordinates of mousemove event to set label coordinates
    var x1 = event.clientX + 10,
        y1 = event.clientY - 75,
        x2 = event.clientX - labelWidth - 10,
        y2 = event.clientY + 25;

    //horizontal label coordinate, testing for overflow
    var x = event.clientX > window.innerWidth - labelWidth - 20 ? x2 : x1; 
    //vertical label coordinate, testing for overflow
    var y = event.clientY < 75 ? y2 : y1; 

    d3.select(".infolabel")
        .style("left", x + "px")
        .style("top", y + "px");
};
})();
