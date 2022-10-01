var map;
//declare minValue var in global scope
var dataStats = {};
//function to instantiate the leaflet map
function createMap(){
    //create the map
    map = L.map('map', {
        center: [38, 1],
        zoom:2,
 
    });

    //add base tilelayer
     L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        tileSize: 512,
        zoomOffset: -1,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);

    //call getData function
    getData(map);
};

function calcStats(data){
    //create empty array to store all data values
    var allValues = [];
    //loop through launch sites
    for(var FullName of data.features){
        //loop through each year
        for(var year = 1957; year <= 2015; year+=1){
           
            if (FullName.properties["RL_" + String(year)] > 0) {
                var value = FullName.properties["RL_" + String(year)]
                allValues.push(value);
            }
        }
    }
   
    
   //get min, max, stats and add other stats for legend
   dataStats.min = 1
   dataStats.small = 5
   dataStats.max = Math.max(...allValues);
   dataStats.med = 35

   console.log(allValues);
}

//calculate the radius of each proportional symbol
function calcPropRadius(attValue) {
  //define radius for points with a value
    if (attValue >= 1){
    //constant factor adjusts symbol sizes evenly
    var minRadius = 5;
    //Flannery Apperance Compensation formula
    var radius = .8 * Math.pow(attValue/dataStats.min,0.5715) * minRadius
    return radius;
  } else {
    var radius = 1;
    return radius;
  };
};

//create popup content
function PopupContent(properties, attribute){
  this.properties = properties;
  this.attribute = attribute;
  this.year = attribute.split("_")[1];
  this.launches = this.properties[attribute];
  this.formatted = "<p><b>Launch Site:</b> " + this.properties.FullName + "</p><p><b>Number of launches in " + this.year + ":</b> " + this.launches + "</p>";
}

//function to convert markers to circle markers and add popups
function pointToLayer(feature, latlng, attributes){
    //Determine which attribute to visualize with proportional symbols
    var attribute = attributes[0];
    //For each feature, determine its value for the selected attribute
    var attValue = Number(feature.properties[attribute]);

    console.log(feature.properties, attValue);

    //create marker options
    var options = {
        fillColor: "#ffe4c4",
        color: '#ffe4c4',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
     };
     
    options.radius = calcPropRadius(attValue);
    //create circle marker layer
    var layer = L.circleMarker(latlng, options);
    //build popup content string starting with city...Example 2.1 line 24
    var popupContent = new PopupContent(feature.properties, attribute);
    //bind the popup to the circle marker
    layer.bindPopup(popupContent.formatted, {
          offset: new L.Point(0,-options.radius)
      });
    //return the circle marker to the L.geoJson pointToLayer option
    return layer;
  };

//create proportional symbols
function createPropSymbols(data, attributes){
    //create a Leaflet GeoJSON layer and add it to the map
    L.geoJson(data, {
        pointToLayer: function(feature, latlng){
            return pointToLayer(feature, latlng, attributes);
        }
    }).addTo(map);
};

//Resize proportional symbols according to new attribute values
function updatePropSymbols(attribute){
    var year = attribute.split("_")[1];
    //update temporal legend
    document.querySelector("span.year").innerHTML = year;

    map.eachLayer(function(layer){
        if (layer.feature && layer.feature.properties[attribute]){
          //access feature properties
           var props = layer.feature.properties;
           //update each feature's radius based on new attribute values
           var radius = calcPropRadius(props[attribute]);
           layer.setRadius(radius);
           //add city to popup content string
           var popupContent = new PopupContent(props, attribute);
           //update popup with new content
           popup = layer.getPopup();
           popup.setContent(popupContent.formatted).update();
        };
    });
};

function processData(data){
    //empty array to hold attribute
    var attributes = [];
    //properties of the first feature in the dataset
    var properties = data.features[0].properties;
    //push each attribute name into attribute array
    for (var attribute in properties){
        //only take attribute with population values
        if (attribute.indexOf("RL") > -1){
            attributes.push(attribute);
        };
    };


    return attributes;
};

//Create new sequence controls
function createSequenceControls(attributes){
    var SequenceControl = L.Control.extend({
        options: {
            position: 'bottomleft'
        },
    
        onAdd: function(){
          
            var container = L.DomUtil.create('div', 'sequence-control-container');


            container.insertAdjacentHTML('beforeend', '<button class="step" id="reverse" title="Reverse"><img src="img/reverse.png"></button>');
            container.insertAdjacentHTML('beforeend', '<button class="step" id="forward" title="Forward"><img src="img/forward.png"></button>');

     
            container.insertAdjacentHTML('beforeend', '<input class="range-slider" type="range">') 

            L.DomEvent.disableClickPropagation(container);


            return container;

        }
    });

    map.addControl(new SequenceControl());

    //set slider attribute to fit data
    document.querySelector(".range-slider").max = 58;
    document.querySelector(".range-slider").min = 0;
    document.querySelector(".range-slider").value = 0;
    document.querySelector(".range-slider").step = 1;

    // select each step and save as a variable
    var steps = document.querySelectorAll('.step');

    // loop with each individual step as the parameter
    steps.forEach(function(step){
        // add a click event listener to each step
        step.addEventListener("click", function(){
            // obtain current index 
            var index = document.querySelector('.range-slider').value;
            // increment or decrement index depending on button clicked
            // if the step's id is forward, increment index 
            if (step.id == 'forward'){
                index++;
                // if past the last attribute, wrap around to first attribute
                index = index > 58 ? 0 : index;
            // if the step's id is reverse, decrement index 
            } else if (step.id == 'reverse'){
                index--;
                // if past the first attribute, wrap around to last attribute
                index = index < 0 ? 58 : index;
            };

            // update the current value of the range-slider to the index
            document.querySelector('.range-slider').value = index;

            // reassign the current attribute based on the new index
            updatePropSymbols(attributes[index]);
        })
    })

    // add input event listener to .range-slider that fires when slider thumb moved or clicks
    document.querySelector('.range-slider').addEventListener('input', function(){
    
        var index = this.value;

        updatePropSymbols(attributes[index]);
    });

};
//create legend
function createLegend(attributes){
    // extend the control for the legend
    var LegendControl = L.Control.extend({
        options:{
            position: 'bottomright'
        },

        // onAdd contains code that creates DOM elements, adds them to map, and puts listeners on relevant map events
        onAdd: function(){
            // create control container div named legend-control-container
            var container = L.DomUtil.create('div','legend-control-container');

            // set the html content of the container 
            container.innerHTML = '<div class="temporalLegend">Rocket launches <b><span class="year">1957</b></span></div>';

            // start attribute legend svg string
            var svg = '<svg id="attribute-legend" width="160px" height="100px">';

            // create array of circle names on which to base loop
            var circles = ["max", "med", "small"];
            
            // loop to add each circle and text to svg string
            for (var i=0; i<circles.length; i++){
            
                //Step 3: assign the r and cy attributes            
                var radius = calcPropRadius(dataStats[circles[i]]);           
                var cy = 100 - radius;            
                var cx = 30
                //circle string            
                svg += '<circle class="legend-circle" id="' + circles[i] + '" r="' + radius + '"cy="' + cy + '" fill="#ffe4c4" fill-opacity="0.8" stroke="#000000" cx="65"/>';
                
                //evenly space out labels            
                var textY = i * 34 + 25;            
                
                //text string            
                svg += '<text id="' + circles[i] + '-text" x="130" y="' + textY + '">' + Math.round(dataStats[circles[i]]*100)/100 + '</text>';
            };
    
            //close svg string
            svg += "</svg>";
    
            //add attribute legend svg to container
            container.insertAdjacentHTML('beforeend',svg);
        

            return container
        }
    
    });

    map.addControl(new LegendControl());

};

function getData(map){
    //load the data
    fetch("data/Rlaunches2.geojson")
        .then(function(response){
            return response.json();
        })
        .then(function(json){
            var attributes = processData(json);
            calcStats(json);
            createPropSymbols(json, attributes);
            createSequenceControls(attributes);
            createLegend(attributes);
        })
};

document.addEventListener('DOMContentLoaded',createMap)