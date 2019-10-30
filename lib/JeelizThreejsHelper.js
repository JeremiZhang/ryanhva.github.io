/*
  Helper for Three.js
*/
"use strict";

THREE.JeelizHelper = function () {
  //internal settings
  var _settings = {
    rotationOffsetX: 0, //negative -> look upper. in radians
    pivotOffsetYZ: [0.4, 0.2], //[0.2,0.2], //XYZ of the distance between the center of the cube and the pivot. enable _settings.isDebugPivotPoint to set this value

    detectionThreshold: 0.75, //sensibility, between 0 and 1. Less -> more sensitive
    detectionHysteresis: 0.05,

    tweakMoveYRotateY: 0.5, //tweak value: move detection window along Y axis when rotate the face

    cameraMinVideoDimFov: 10, //Field of View for the smallest dimension of the video in degrees

    isDebugPivotPoint: false //display a small cube for the pivot point
  };

  //private vars :
  var _threeRenderer = null,
      _threeScene = null,
      _threeVideoMesh = null,
      _threeVideoTexture = null;

  var _maxFaces = 2,
      _isMultiFaces = true,
      _detect_callback = null,
      _isVideoTextureReady = false,
      _isSeparateThreejsCanvas = false,
      _faceFilterCv = null,
      _videoElement = null,
      _isDetected = false,
      _scaleW = 1;

  var _threeCompositeObjects = [],
      _threePivotedObjects = [];

  var _gl = null,
      _glVideoTexture = null,
      _glShpCopy = null;

  //private funcs :
  function create_threeCompositeObjects() {
    for (var i = 0; i < _maxFaces; ++i) {
      //COMPOSITE OBJECT WHICH WILL TRACK A DETECTED FACE
      //in fact we create 2 objects to be able to shift the pivot point
      var threeCompositeObject = new THREE.Object3D();
      threeCompositeObject.frustumCulled = false;
      threeCompositeObject.visible = false;

      var threeCompositeObjectPIVOTED = new THREE.Object3D();
      threeCompositeObjectPIVOTED.frustumCulled = false;
      threeCompositeObject.add(threeCompositeObjectPIVOTED);

      _threeCompositeObjects.push(threeCompositeObject);
      _threePivotedObjects.push(threeCompositeObjectPIVOTED);
      _threeScene.add(threeCompositeObject);

      if (_settings.isDebugPivotPoint) {
        var pivotCubeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshNormalMaterial({
          side: THREE.DoubleSide,
          depthTest: false
        }));
        pivotCubeMesh.position.copy(threeCompositeObjectPIVOTED.position);
        threeCompositeObject.add(pivotCubeMesh);
        window.pivot = pivotCubeMesh;
        console.log('DEBUG in JeelizHelper: set the position of <pivot> in the console and report the value into JeelizThreejsHelper.js for _settings.pivotOffsetYZ');
      }
    }
  }

  function create_videoScreen() {
    var videoScreenVertexShaderSource = "attribute vec2 position;\n\
        varying vec2 vUV;\n\
        void main(void){\n\
          gl_Position = vec4(position, 0., 1.);\n\
          vUV = 0.5+0.5*position;\n\
        }";
    var videoScreenFragmentShaderSource = "precision lowp float;\n\
        uniform sampler2D samplerVideo;\n\
        varying vec2 vUV;\n\
        void main(void){\n\
          gl_FragColor = texture2D(samplerVideo, vUV);\n\
        }";

    if (_isSeparateThreejsCanvas) {
      var compile_shader = function compile_shader(source, type, typeString) {
        var shader = _gl.createShader(type);
        _gl.shaderSource(shader, source);
        _gl.compileShader(shader);
        if (!_gl.getShaderParameter(shader, _gl.COMPILE_STATUS)) {
          alert("ERROR IN " + typeString + " SHADER : " + _gl.getShaderInfoLog(shader));
          return false;
        }
        return shader;
      };

      var shader_vertex = compile_shader(videoScreenVertexShaderSource, _gl.VERTEX_SHADER, 'VERTEX');
      var shader_fragment = compile_shader(videoScreenFragmentShaderSource, _gl.FRAGMENT_SHADER, 'FRAGMENT');

      _glShpCopy = _gl.createProgram();
      _gl.attachShader(_glShpCopy, shader_vertex);
      _gl.attachShader(_glShpCopy, shader_fragment);

      _gl.linkProgram(_glShpCopy);
      var samplerVideo = _gl.getUniformLocation(_glShpCopy, 'samplerVideo');

      return;
    }

    //init video texture with red
    _threeVideoTexture = new THREE.DataTexture(new Uint8Array([255, 0, 0]), 1, 1, THREE.RGBFormat);
    _threeVideoTexture.needsUpdate = true;

    //CREATE THE VIDEO BACKGROUND
    var videoMaterial = new THREE.RawShaderMaterial({
      depthWrite: false,
      depthTest: false,
      vertexShader: videoScreenVertexShaderSource,
      fragmentShader: videoScreenFragmentShaderSource,
      uniforms: {
        samplerVideo: { value: _threeVideoTexture }
      }
    });
    var videoGeometry = new THREE.BufferGeometry();
    var videoScreenCorners = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
    videoGeometry.addAttribute('position', new THREE.BufferAttribute(videoScreenCorners, 2));
    videoGeometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    _threeVideoMesh = new THREE.Mesh(videoGeometry, videoMaterial);
    that.apply_videoTexture(_threeVideoMesh);
    _threeVideoMesh.renderOrder = -1000; //render first
    _threeVideoMesh.frustumCulled = false;
    _threeScene.add(_threeVideoMesh);
  } //end create_videoScreen()

  function _detect(detectState) {
    _threeCompositeObjects.forEach(function (threeCompositeObject, i) {
      _isDetected = threeCompositeObject.visible;
      var ds = detectState[i];
      if (_isDetected && ds.detected < _settings.detectionThreshold - _settings.detectionHysteresis) {

        //DETECTION LOST
        if (_detect_callback) _detect_callback(i, false);
        threeCompositeObject.visible = false;
      } else if (!_isDetected && ds.detected > _settings.detectionThreshold + _settings.detectionHysteresis) {

        //FACE DETECTED
        if (_detect_callback) _detect_callback(i, true);
        threeCompositeObject.visible = true;
      }
    }); //end loop on all detection slots
  }

  function update_positions3D(ds, threeCamera) {
    var halfTanFOV = Math.tan(threeCamera.aspect * threeCamera.fov * Math.PI / 360); //tan(<horizontal FoV>/2), in radians (threeCamera.fov is vertical FoV)

    _threeCompositeObjects.forEach(function (threeCompositeObject, i) {
      if (!threeCompositeObject.visible) return;
      var detectState = ds[i];

      // tweak Y position depending on rx:
      var tweak = _settings.tweakMoveYRotateY * Math.tan(detectState.rx);
      var cz = Math.cos(detectState.rz),
          sz = Math.sin(detectState.rz);

      var s = detectState.s * _scaleW;

      var xTweak = sz * tweak * s;
      var yTweak = cz * tweak * (s * threeCamera.aspect);

      // move the cube in order to fit the head:
      var W = s; //relative width of the detection window (1-> whole width of the detection window)
      var D = 1 / (2 * W * halfTanFOV); //distance between the front face of the cube and the camera

      //coords in 2D of the center of the detection window in the viewport:
      var xv = detectState.x * _scaleW + xTweak;
      var yv = detectState.y + yTweak;

      // coords in 3D of the center of the cube (in the view coordinates system)
      var z = -D - 0.5; // minus because view coordinate system Z goes backward. -0.5 because z is the coord of the center of the cube (not the front face)
      var x = xv * D * halfTanFOV;
      var y = yv * D * halfTanFOV / threeCamera.aspect;

      // the pivot position depends on rz rotation:
      _threePivotedObjects[i].position.set(-sz * _settings.pivotOffsetYZ[0], -cz * _settings.pivotOffsetYZ[0], -_settings.pivotOffsetYZ[1]);

      // move and rotate the cube:
      threeCompositeObject.position.set(x, y + _settings.pivotOffsetYZ[0], z + _settings.pivotOffsetYZ[1]);
      threeCompositeObject.rotation.set(detectState.rx + _settings.rotationOffsetX, detectState.ry, detectState.rz, "ZXY");
    }); //end loop on composite objects
  }

  //public methods:
  var that = {
    // launched with the same spec object than callbackReady. set spec.threejsCanvasId to the ID of the threejsCanvas to be in 2 canvas mode:
    init: function init(spec, detectCallback) {
      _maxFaces = spec.maxFacesDetected;
      _glVideoTexture = spec.videoTexture;
      _gl = spec.GL;
      _faceFilterCv = spec.canvasElement;
      _isMultiFaces = _maxFaces > 1;
      _videoElement = spec.videoElement;

      // enable 2 canvas mode if necessary:
      var threejsCanvas = null;
      if (spec.threejsCanvasId) {
        _isSeparateThreejsCanvas = true;
        // adjust the threejs canvas size to the threejs canvas:
        threejsCanvas = document.getElementById(spec.threejsCanvasId);
        threejsCanvas.setAttribute('width', _faceFilterCv.width);
        threejsCanvas.setAttribute('height', _faceFilterCv.height);
      } else {
        threejsCanvas = _faceFilterCv;
      }

      if (typeof detectCallback !== 'undefined') {
        _detect_callback = detectCallback;
      }

      // init THREE.JS context:
      _threeRenderer = new THREE.WebGLRenderer({
        context: _isSeparateThreejsCanvas ? null : _gl,
        canvas: threejsCanvas,
        alpha: _isSeparateThreejsCanvas || spec.alpha ? true : false
      });

      _threeScene = new THREE.Scene();

      create_threeCompositeObjects();
      create_videoScreen();

      // handle device orientation change:
      window.addEventListener('orientationchange', function () {
        setTimeout(JEEFACEFILTERAPI.resize, 1000);
      }, false);

      var returnedDict = {
        videoMesh: _threeVideoMesh,
        renderer: _threeRenderer,
        scene: _threeScene
      };
      if (_isMultiFaces) {
        returnedDict.faceObjects = _threePivotedObjects;
      } else {
        returnedDict.faceObject = _threePivotedObjects[0];
      }
      return returnedDict;
    }, //end that.init()

    detect: function detect(detectState) {
      var ds = _isMultiFaces ? detectState : [detectState];

      // update detection states:
      _detect(ds);
    },

    get_isDetected: function get_isDetected() {
      return _isDetected;
    },

    render: function render(detectState, threeCamera) {
      var ds = _isMultiFaces ? detectState : [detectState];

      //update detection states
      _detect(ds);
      update_positions3D(ds, threeCamera);

      if (_isSeparateThreejsCanvas) {
        //render the video texture on the faceFilter canvas :
        _gl.viewport(0, 0, _faceFilterCv.width, _faceFilterCv.height);
        _gl.useProgram(_glShpCopy);
        _gl.activeTexture(_gl.TEXTURE0);
        _gl.bindTexture(_gl.TEXTURE_2D, _glVideoTexture);
        _gl.drawElements(_gl.TRIANGLES, 3, _gl.UNSIGNED_SHORT, 0);
      } else {
        //reinitialize the state of THREE.JS because JEEFACEFILTER have changed stuffs
        // -> can be VERY costly !
        _threeRenderer.state.reset();
      }

      //trigger the render of the THREE.JS SCENE
      _threeRenderer.render(_threeScene, threeCamera);
    },

    sortFaces: function sortFaces(bufferGeometry, axis, isInv) {
      //sort faces long an axis
      // Useful when a bufferGeometry has alpha : we should render the last faces first
      var axisOffset = { X: 0, Y: 1, Z: 2 }[axis.toUpperCase()];
      var sortWay = isInv ? -1 : 1;

      // fill the faces array:
      var nFaces = bufferGeometry.index.count / 3;
      var faces = new Array(nFaces);
      for (var i = 0; i < nFaces; ++i) {
        faces[i] = [bufferGeometry.index.array[3 * i], bufferGeometry.index.array[3 * i + 1], bufferGeometry.index.array[3 * i + 2]];
      }

      // compute centroids:
      var aPos = bufferGeometry.attributes.position.array;
      var centroids = faces.map(function (face, faceIndex) {
        return [(aPos[3 * face[0]] + aPos[3 * face[1]] + aPos[3 * face[2]]) / 3, //X
        (aPos[3 * face[0] + 1] + aPos[3 * face[1] + 1] + aPos[3 * face[2] + 1]) / 3, //Y
        (aPos[3 * face[0] + 2] + aPos[3 * face[1] + 2] + aPos[3 * face[2] + 2]) / 3, //Z
        face];
      });

      // sort centroids:
      centroids.sort(function (ca, cb) {
        return (ca[axisOffset] - cb[axisOffset]) * sortWay;
      });

      // reorder bufferGeometry faces:
      centroids.forEach(function (centroid, centroidIndex) {
        var face = centroid[3];
        bufferGeometry.index.array[3 * centroidIndex] = face[0];
        bufferGeometry.index.array[3 * centroidIndex + 1] = face[1];
        bufferGeometry.index.array[3 * centroidIndex + 2] = face[2];
      });
    }, //end sortFaces

    get_threeVideoTexture: function get_threeVideoTexture() {
      return _threeVideoTexture;
    },

    apply_videoTexture: function apply_videoTexture(threeMesh) {
      if (_isVideoTextureReady) {
        return;
      }
      threeMesh.onAfterRender = function () {
        // Replace _threeVideoTexture.__webglTexture by the real video texture:
        try {
          _threeRenderer.properties.update(_threeVideoTexture, '__webglTexture', _glVideoTexture);
          _threeVideoTexture.magFilter = THREE.LinearFilter;
          _threeVideoTexture.minFilter = THREE.LinearFilter;
          _isVideoTextureReady = true;
        } catch (e) {
          console.log('WARNING in THREE.JeelizHelper : the glVideoTexture is not fully initialized');
        }
        delete threeMesh.onAfterRender;
      };
    },

    // create an occluder, IE a transparent object which writes on the depth buffer:
    create_threejsOccluder: function create_threejsOccluder(occluderURL, callback) {
      var occluderMesh = new THREE.Mesh();
      new THREE.BufferGeometryLoader().load(occluderURL, function (occluderGeometry) {
        var mat = new THREE.ShaderMaterial({
          vertexShader: THREE.ShaderLib.basic.vertexShader,
          fragmentShader: "precision lowp float;\n void main(void){\n gl_FragColor=vec4(1.,0.,0.,1.);\n }",
          uniforms: THREE.ShaderLib.basic.uniforms,
          colorWrite: false
        });

        occluderMesh.renderOrder = -1; //render first
        occluderMesh.material = mat;
        occluderMesh.geometry = occluderGeometry;
        if (typeof callback !== 'undefined' && callback) callback(occluderMesh);
      });
      return occluderMesh;
    },

    set_pivotOffsetYZ: function set_pivotOffsetYZ(pivotOffset) {
      _settings.pivotOffsetYZ = pivotOffset;
    },

    create_camera: function create_camera(zNear, zFar) {
      var threeCamera = new THREE.PerspectiveCamera(1, 1, zNear ? zNear : 0.1, zFar ? zFar : 100);
      that.update_camera(threeCamera);

      return threeCamera;
    },

    update_camera: function update_camera(threeCamera) {
      // compute aspectRatio:
      var canvasElement = _threeRenderer.domElement;
      var cvw = canvasElement.width;
      var cvh = canvasElement.height;
      var canvasAspectRatio = cvw / cvh;

      // compute vertical field of view:
      var vw = _videoElement.videoWidth;
      var vh = _videoElement.videoHeight;
      var videoAspectRatio = vw / vh;
      var fovFactor = vh > vw ? 1.0 / videoAspectRatio : 1.0;
      var fov = _settings.cameraMinVideoDimFov * fovFactor;
      var mobileview = 640;

      console.log('fovfactor: ', fovFactor);

      // compute X and Y offsets in pixels:
      var scale = 1.0;
      if (canvasAspectRatio > videoAspectRatio) {
        // the canvas is more in landscape format than the video, so we crop top and bottom margins:
        scale = cvw / vw;
      } else {
        // the canvas is more in portrait format than the video, so we crop right and left margins:
        scale = cvh / vh;
      }

      // the canvas is off a mobile and requires a different scaling.
      // if (cvw < mobileview) {
      //   fov = 10;
      // }

      var cvws = vw * scale,
          cvhs = vh * scale;
      var offsetX = (cvws - cvw) / 2.0;
      var offsetY = (cvhs - cvh) / 2.0;
      _scaleW = cvw / cvws;

      console.log('canvas Aspect: ', canvasAspectRatio, 'fov: ', fov);

      // apply parameters:
      threeCamera.aspect = canvasAspectRatio;
      threeCamera.fov = fov;
      console.log('INFO in JeelizThreejsHelper.update_camera() : camera vertical estimated FoV is', fov);
      threeCamera.setViewOffset(cvws, cvhs, offsetX, offsetY, cvw, cvh);
      threeCamera.updateProjectionMatrix();

      // update drawing area:
      _threeRenderer.setSize(cvw, cvh);
      _threeRenderer.setViewport(0, 0, cvw, cvh);

      console.log('DOM width: ', _threeRenderer.domElement.width, 'height: ', _threeRenderer.domElement.height, 'scale: ', scale, 'cvws: ', cvws, 'offsetX: ', offsetX, 'offsetY: ', offsetY, 'cvw: ', cvw);
    }
  };
  return that;
}();