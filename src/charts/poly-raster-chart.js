import rasterMixin from "../mixins/raster-mixin"
import mapMixin from "../mixins/map-mixin"
import colorMixin from "../mixins/color-mixin"
import capMixin from "../mixins/cap-mixin"
import baseMixin from "../mixins/base-mixin"

export default function polyRasterChart (parent, useMap, chartGroup, _mapboxgl) {
  var chart = rasterMixin(mapMixin(colorMixin(capMixin(baseMixin({}))), parent.attributes.id.value, _mapboxgl, false))
  var layer = {isActive: false, name: "overlay_polygons"};
  var renderBoundsMap = {};
  var hasBeenRendered = false;

  var _usePixelRatio = false;
  var _pixelRatio = 1;

  chart.opacity = createGetterSetter(chart, 0.85)

  chart.borderColor = createGetterSetter(chart, "white")

  chart.borderWidth = createGetterSetter(chart, 0.5)

  chart.polyJoin = createGetterSetter(chart, {table: "states", keysColumn: "STATE_ABBR"}, polyJoinValidator)

  // TODO(croot): pixel ratio should probably be configured on the backend
  // rather than here to deal with scenarios where data is used directly
  // in pixel-space.
  chart.usePixelRatio = function(usePixelRatio) {
      if (!arguments.length) {
          return _usePixelRatio;
      }

      _usePixelRatio = !!usePixelRatio;
      if (_usePixelRatio) {
          _pixelRatio = window.devicePixelRatio || 1;
      } else {
          _pixelRatio = 1;
      }

      return chart;
  }

  chart._getPixelRatio = function() {
      return _pixelRatio;
  }


  chart.resetLayer = function() {
    renderBoundsMap = {};
    layer.isActive = false;
  }

  chart.setDataAsync(function(group, callback) {
    var bounds = chart.map().getBounds();
    var renderBounds = [
      valuesOb(bounds.getNorthWest()),
      valuesOb(bounds.getNorthEast()),
      valuesOb(bounds.getSouthEast()),
      valuesOb(bounds.getSouthWest())
    ]

    var sql;
    if (group.type === "dimension") {
      sql = group.writeTopQuery(chart.cap(), 0, true);
    } else {
      sql = group.writeTopQuery(chart.cap(), 0, false, true);
    }
    chart._resetVegaSpec();

    genPolyVegaSpec(
      sql,
      chart._vegaSpec,
      renderBounds.map(chart.conv4326To900913),
      chart.colors(),
      chart.polyJoin(),
      {strokeColor: chart.borderColor(), strokeWidth: chart.borderWidth() * _pixelRatio}
    );
    var nonce = chart.con().renderVega(1, JSON.stringify(chart._vegaSpec), {}, callback);
    renderBoundsMap[nonce] = renderBounds;
  });

  chart._doRenderAsync = function () {
    chart.dataAsync(function (error, data) {
      if (Object.keys(data).length && chart.map()._loaded) {
        setOverlay(data.image, renderBoundsMap[data.nonce], chart.map(), layer, chart.opacity());
      }
    });
  };

  chart._doRender = chart._doRenderAsync

  chart._doRedraw = chart._doRender

  return chart.anchor(parent, chartGroup);
}

function genPolyVegaSpec(sqlstr, vegaSpec, mapBoundsMerc, color, polyJoin, stroke) {
  var xDomain = [mapBoundsMerc[0][0], mapBoundsMerc[2][0]] // northwest x, southeast x
  var yDomain = [mapBoundsMerc[2][1], mapBoundsMerc[0][1]] // southeast y, northwest y
  var xScale = {name: "x", type: "linear", domain: xDomain, range: "width"}
  var yScale = {name: "y", type: "linear", domain: yDomain, range: "height"}
  var colorScale = {name: "color", type: "linear", domain: color.domain(), range: color.range()}
  vegaSpec.scales = [xScale, yScale, colorScale];
  vegaSpec.marks = [{
    type: "polys",
    from: {data: "table"},
    properties: Object.assign({
      x: {scale: "x", field: "x"},
      y: {scale: "y", field: "y"},
      fillColor: {scale: "color", field: "val"}
    }, stroke.strokeColor && stroke.strokeWidth ? stroke : {})
  }];
  vegaSpec.data = [{
    "name": "table",
    "format": "polys",
    "sql": sqlstr,
    "dbTableName": polyJoin.table,
    "polysKey": polyJoin.keysColumn,
    "shapeColGroup": "mapd"
  }]
}

function setOverlay(data, bounds, map, layer, opacity){
  if (typeof data === "undefined") { throw new Error("Data is undefined") }
  var browser = detectBrowser()
  var blobUrl = browser.isSafari || browser.isIE || browser.isEdge ? URL.createObjectURL(b64toBlob(data, "image/png")) : "data:image/png;base64," + data
  if (layer.isActive) {
    var imageSrc = map.getSource(layer.name);
    imageSrc.updateImage({
      url: blobUrl,
      coordinates: bounds
    });
  } else {
    layer.isActive = true
    map.addSource(layer.name, {
      type: "image",
      url: blobUrl,
      coordinates: bounds
    });
    map.addLayer({
      id: layer.name,
      source: layer.name,
      type: "raster",
      paint: {"raster-opacity": opacity, "raster-fade-duration": 0}
    });
  }
}

function detectBrowser () { // from SO: http://bit.ly/1Wd156O
  var isOpera = (!!window.opr && !!opr.addons) || !!window.opera || navigator.userAgent.indexOf(" OPR/") >= 0;
  var isFirefox = typeof InstallTrigger !== "undefined";
  var isSafari = Object.prototype.toString.call(window.HTMLElement).indexOf("Constructor") > 0;
  var isIE = /*@cc_on!@*/false || !!document.documentMode;
  var isEdge = !isIE && !!window.StyleMedia;
  var isChrome = !!window.chrome && !!window.chrome.webstore;
  return {isOpera: isOpera, isFirefox: isFirefox, isSafari: isSafari, isIE: isIE, isEdge: isEdge, isChrome: isChrome}
}

function b64toBlob(b64Data, contentType, sliceSize) {
  contentType = contentType || "";
  sliceSize = sliceSize || 512;
  var byteCharacters = atob(b64Data);
  var byteArrays = [];
  for (var offset = 0; offset < byteCharacters.length; offset += sliceSize) {
    var slice = byteCharacters.slice(offset, offset + sliceSize);
    var byteNumbers = new Array(slice.length);
    for (var i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    var byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }
  return new Blob(byteArrays, {type: contentType});
}

function valuesOb (obj) { return Object.keys(obj).map(function (key) { return obj[key]; }) }

function createGetterSetter (chainableObject, oldVal, validator) {
  validator = validator || identity
  return function (newVal) {
    oldVal = newVal ? validator(newVal) : oldVal
    return newVal ? chainableObject : oldVal
  }
}

function identity (x) { return x }

function polyJoinValidator (newPolyJoin) {
  if (typeof newPolyJoin.table === "string" && typeof newPolyJoin.keysColumn === "string") {
    return newPolyJoin
  } else {
    throw new Error(".polyJoin takes {table: STRING, keysColumn: STRING}.")
  }
}
