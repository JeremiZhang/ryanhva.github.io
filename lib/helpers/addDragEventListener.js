"use strict";

var _states = {
  idle: 0,
  loading: 1,
  dragging: 2
};
var _state = _states.idle; // MT217 : initialize your state always (even with a loading value)

var _dP = new window.THREE.Vector3();
var _x0 = void 0;var _y0 = void 0;
var _scenes = void 0;
var _boundFunction = void 0;

function updateMeshPosition(canvas, event) {
  var MOUSEVECTOR = new window.THREE.Vector3();
  var DIRECTIONVECTOR = new window.THREE.Vector3();
  var VIEWPORTVECTOR = new window.THREE.Vector3();
  var _headCenterZ = -1;

  if (_state !== _states.dragging) return; // MT217

  var isTouch = !!(event.touches && event.touches.length); // MT217 is touch or mouse event ?

  var xPx = isTouch ? event.touches[0].clientX : event.clientX; // MT217 : make the distinction between touch and mouse event
  var yPx = isTouch ? event.touches[0].clientY : event.clientY; // if touch event, consider only the first finger

  var dxPx = xPx - _x0; // in pixels
  var dyPx = yPx - _y0; // in pixels too

  _x0 = xPx;
  _y0 = yPx;

  // calcul des coo de dxPx, dyPx dans le viewport
  // les offsets du canvas s'annulent -> que facteur d'échelle a appliquer
  var dx = -dxPx / canvas.offsetWidth;
  var dy = -dyPx / canvas.offsetHeight;

  // Only check intersects if object is visible
  // If there is only 1 object, we don't check intersections too
  var mesh = _scenes.length === 1 ? _scenes[0] : _scenes.find(function (scene) {
    if (!scene.parent.visible) {
      return false;
    }
    // TODO: Check if a child geometry is an occlusion object. If so remove it from the intersection list
    MOUSEVECTOR.set(-(xPx / canvas.offsetWidth) * 2 + 1, -(yPx / canvas.offsetHeight) * 2 + 1, 0.5);
    var raycaster = new window.THREE.Raycaster();
    raycaster.setFromCamera(MOUSEVECTOR, window.THREECAMERA);

    var intersects = raycaster.intersectObjects(scene.children);
    return intersects.length > 0;
  });

  if (!mesh) {
    return;
  }

  VIEWPORTVECTOR.set(dx, dy, 1);

  DIRECTIONVECTOR.copy(VIEWPORTVECTOR);
  if (!window.THREECAMERA) {
    throw new Error('Cannot find the THREE.js camera. Please check that window.THREECAMERA is the default scene camera');
  }
  DIRECTIONVECTOR.unproject(window.THREECAMERA);
  DIRECTIONVECTOR.sub(window.THREECAMERA.position);
  DIRECTIONVECTOR.normalize();

  // we calculate the coefficient that will allow us to find our mesh's position
  var k = _headCenterZ / DIRECTIONVECTOR.z;

  // _dP = displacement in the scene (=world) ref :
  _dP.copy(DIRECTIONVECTOR).multiplyScalar(k);
  _dP.setZ(0); // bcoz we only want to displace in the (0xy) plane

  var _quat = new window.THREE.Quaternion();
  var _eul = new window.THREE.Euler();
  _eul.setFromQuaternion(_quat);

  // convert _dP to mesh ref to apply it directly to mesh.position :
  // _dP is a vector so apply only the rotation part (not the translation)
  _dP.applyEuler(mesh.getWorldQuaternion(_eul));

  // Boost movement to follow better the mouse/touch
  _dP.multiplyScalar(10);

  // apply _dP
  mesh.position.add(_dP);
}

function setMousePosition0(event) {
  // save initial position of the mouse
  var isTouch = !!(event.touches && event.touches.length); // MT217 is touch or mouse event ?

  if (isTouch && event.touches.length > 1) return; // MT217 if the user put a second finger while dragging

  _x0 = isTouch ? event.touches[0].clientX : event.clientX; // MT217
  _y0 = isTouch ? event.touches[0].clientY : event.clientY;
}

function mouseDown(event) {
  setMousePosition0(event); // MANTIS201
  _state = _states.dragging;
}

function mouseUp() {
  _state = _states.idle;
}

function addDragEventListener(scenes, canvasId, remove) {
  _scenes = Array.isArray(scenes) ? scenes : [scenes];
  var canvas = document.getElementById(typeof canvasId === 'undefined' ? 'jeeFaceFilterCanvas' : canvasId);

  _state = _states.idle; // MT217 : initialize your state always (even with a loading value)

  _dP = new window.THREE.Vector3();
  _x0 = undefined;_y0 = undefined;
  if (remove) {
    // REMOVE OUR LISTENERS
    canvas.removeEventListener('mousemove', _boundFunction, true);
    canvas.removeEventListener('touchmove', _boundFunction, true);

    // BEGINNING OF THE INTERACTION
    canvas.removeEventListener('mousedown', mouseDown);
    canvas.removeEventListener('touchstart', mouseDown);

    // END OF THE INTERACTION
    canvas.removeEventListener('mouseup', mouseUp);
    canvas.removeEventListener('touchend', mouseUp);

    // ALSO END BUT IN CASE LEAVING CANVAS OR ALERT BOX ECT...
    canvas.removeEventListener('mouseout', mouseUp);
    canvas.removeEventListener('touchcancel', mouseUp);
  } else {
    // SET OUR LISTENERS
    _boundFunction = updateMeshPosition.bind(this, canvas);
    canvas.addEventListener('mousemove', _boundFunction, true);
    // canvas.addEventListener('touchmove', createTouchEvent, true)
    canvas.addEventListener('touchmove', _boundFunction, true); // MT217

    // BEGINNING OF THE INTERACTION
    canvas.addEventListener('mousedown', mouseDown);
    canvas.addEventListener('touchstart', mouseDown);

    // END OF THE INTERACTION
    canvas.addEventListener('mouseup', mouseUp);
    canvas.addEventListener('touchend', mouseUp);

    // ALSO END BUT IN CASE LEAVING CANVAS OR ALERT BOX ECT...
    canvas.addEventListener('mouseout', mouseUp);
    canvas.addEventListener('touchcancel', mouseUp);
  }
}