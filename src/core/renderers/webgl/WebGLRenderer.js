import SystemRenderer from '../SystemRenderer';
import MaskManager from './managers/MaskManager';
import StencilManager from './managers/StencilManager';
import FilterManager from './managers/FilterManager';
import FramebufferManager from './managers/FramebufferManager';
import RenderTextureManager from './managers/RenderTextureManager';
import NewTextureManager from './managers/NewTextureManager';
import RenderTarget from './utils/RenderTarget';
import ObjectRenderer from './utils/ObjectRenderer';
import TextureManager from './TextureManager';
import ProjectionManager from './managers/ProjectionManager';
import StateManager from './managers/StateManager';
import ShaderManager from './ShaderManager';
import BaseTexture from '../../textures/BaseTexture';
import TextureGarbageCollector from './TextureGarbageCollector';
import mapWebGLDrawModesToPixi from './utils/mapWebGLDrawModesToPixi';
import validateContext from './utils/validateContext';
import { pluginTarget } from '../../utils';
import glCore from 'pixi-gl-core';
import { RENDERER_TYPE } from '../../const';
import UniformGroup from '../../shader/UniformGroup';
import { Rectangle, Matrix } from '../../math';


let CONTEXT_UID = 0;

/**
 * The WebGLRenderer draws the scene and all its content onto a webGL enabled canvas. This renderer
 * should be used for browsers that support webGL. This Render works by automatically managing webGLBatchs.
 * So no need for Sprite Batches or Sprite Clouds.
 * Don't forget to add the view to your DOM or you will not see anything :)
 *
 * @class
 * @memberof PIXI
 * @extends PIXI.SystemRenderer
 */
export default class WebGLRenderer extends SystemRenderer
{
    /**
     *
     * @param {number} [screenWidth=800] - the width of the screen
     * @param {number} [screenHeight=600] - the height of the screen
     * @param {object} [options] - The optional renderer parameters
     * @param {HTMLCanvasElement} [options.view] - the canvas to use as a view, optional
     * @param {boolean} [options.transparent=false] - If the render view is transparent, default false
     * @param {boolean} [options.autoResize=false] - If the render view is automatically resized, default false
     * @param {boolean} [options.antialias=false] - sets antialias. If not available natively then FXAA
     *  antialiasing is used
     * @param {boolean} [options.forceFXAA=false] - forces FXAA antialiasing to be used over native.
     *  FXAA is faster, but may not always look as great
     * @param {number} [options.resolution=1] - The resolution / device pixel ratio of the renderer.
     *  The resolution of the renderer retina would be 2.
     * @param {boolean} [options.clearBeforeRender=true] - This sets if the CanvasRenderer will clear
     *  the canvas or not before the new render pass. If you wish to set this to false, you *must* set
     *  preserveDrawingBuffer to `true`.
     * @param {boolean} [options.preserveDrawingBuffer=false] - enables drawing buffer preservation,
     *  enable this if you need to call toDataUrl on the webgl context.
     * @param {boolean} [options.roundPixels=false] - If true Pixi will Math.floor() x/y values when
     *  rendering, stopping pixel interpolation.
     * @param {boolean} [options.legacy=false] - If true Pixi will aim to ensure compatibility
     * with older / less advanced devices. If you experiance unexplained flickering try setting this to true.
     */
    constructor(screenWidth, screenHeight, options = {})
    {
        super('WebGL', screenWidth, screenHeight, options);

        this.legacy = !!options.legacy;

        if (this.legacy)
        {
            glCore.VertexArrayObject.FORCE_NATIVE = true;
        }

        /**
         * The type of this renderer as a standardised const
         *
         * @member {number}
         * @see PIXI.RENDERER_TYPE
         */
        this.type = RENDERER_TYPE.WEBGL;

        this.handleContextLost = this.handleContextLost.bind(this);
        this.handleContextRestored = this.handleContextRestored.bind(this);

        this.view.addEventListener('webglcontextlost', this.handleContextLost, false);
        this.view.addEventListener('webglcontextrestored', this.handleContextRestored, false);

        /**
         * The options passed in to create a new webgl context.
         *
         * @member {object}
         * @private
         */
        this._contextOptions = {
            alpha: this.transparent,
            antialias: options.antialias,
            premultipliedAlpha: this.transparent && this.transparent !== 'notMultiplied',
            stencil: true,
            preserveDrawingBuffer: options.preserveDrawingBuffer,
        };

        this._backgroundColorRgba[3] = this.transparent ? 0 : 1;

        /**
         * Manages the masks using the stencil buffer.
         *
         * @member {PIXI.MaskManager}
         */
        this.maskManager = new MaskManager(this);

        /**
         * Manages the stencil buffer.
         *
         * @member {PIXI.StencilManager}
         */
        this.stencilManager = new StencilManager(this);

        /**
         * An empty renderer.
         *
         * @member {PIXI.ObjectRenderer}
         */
        this.emptyRenderer = new ObjectRenderer(this);

        this.framebuffer  = new FramebufferManager(this);
        this.texture = new NewTextureManager(this);
        this.renderTexture = new RenderTextureManager(this);
        this.projection = new ProjectionManager(this);

        this.globalUniforms = new UniformGroup({
            projectionMatrix:new Matrix()
        }, true)

        /**
         * The currently active ObjectRenderer.
         *
         * @member {PIXI.ObjectRenderer}
         */
        this.currentRenderer = this.emptyRenderer;

        this.initPlugins();

        /**
         * The current WebGL rendering context, it is created here
         *
         * @member {WebGLRenderingContext}
         */
        // initialize the context so it is ready for the managers.
        if (options.context)
        {
            // checks to see if a context is valid..
            validateContext(options.context);
        }

        this.gl = options.context || glCore.createContext(this.view, this._contextOptions);

        this.CONTEXT_UID = CONTEXT_UID++;

        /**
         * The currently active ObjectRenderer.
         *
         * @member {PIXI.WebGLState}
         */
//        this.state = new WebGLState(this.gl);
        this.state = new StateManager(this.gl);
        this.state.setBlendMode(0);


        this.renderingToScreen = true;

        /**
         * Holds the current state of textures bound to the GPU.
         * @type {Array}
         */
        this.boundTextures = null;

        /**
         * Holds the current shader
         *
         * @member {PIXI.Shader}
         */
        this._activeShader = null;

        this._activeVao = null;

        /**
         * Holds the current render target
         *
         * @member {PIXI.RenderTarget}
         */
        this._activeRenderTarget = null;

        this._initContext();

        /**
         * Manages the filters.
         *
         * @member {PIXI.FilterManager}
         */
        this.filterManager = new FilterManager(this);
        // map some webGL blend and drawmodes..
        this.drawModes = mapWebGLDrawModesToPixi(this.gl);

        this._nextTextureLocation = 0;



    }

    /**
     * Creates the WebGL context
     *
     * @private
     */
    _initContext()
    {
        const gl = this.gl;

        // restore a context if it was previously lost
        if (gl.isContextLost() && gl.getExtension('WEBGL_lose_context'))
        {
            gl.getExtension('WEBGL_lose_context').restoreContext();
        }

        const maxTextures = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);

        this.boundTextures = new Array(maxTextures);
        this.emptyTextures = new Array(maxTextures);

        // create a texture manager...
        this.textureManager = new TextureManager(this);
        this.textureGC = new TextureGarbageCollector(this);

        this.shader = new ShaderManager(this);

        this.state.resetToDefault();

        // now lets fill up the textures with empty ones!
        const emptyGLTexture = new glCore.GLTexture.fromData(gl, null, 1, 1);

        const tempObj = { _glTextures: {} };

        tempObj._glTextures[this.CONTEXT_UID] = {};

        for (let i = 0; i < maxTextures; i++)
        {
            const empty = new BaseTexture();

            empty._glTextures[this.CONTEXT_UID] = emptyGLTexture;

            this.boundTextures[i] = tempObj;
            this.emptyTextures[i] = empty;
            this.bindTexture(null, i);
        }

        this.emit('context', gl);

        // set the latest testing context..
        glCore._testingContext = gl;

        // setup the width/height properties and gl viewport
        this.resize(this.screen.width, this.screen.height);
    }

    /**
     * Renders the object to its webGL view
     *
     * @param {PIXI.DisplayObject} displayObject - the object to be rendered
     * @param {PIXI.RenderTexture} renderTexture - The render texture to render to.
     * @param {boolean} [clear] - Should the canvas be cleared before the new render
     * @param {PIXI.Transform} [transform] - A transform to apply to the render texture before rendering.
     * @param {boolean} [skipUpdateTransform] - Should we skip the update transform pass?
     */
    render(displayObject, renderTexture, clear, transform, skipUpdateTransform)
    {
        // can be handy to know!
        this.renderingToScreen = !renderTexture;

        this.emit('prerender');

        // no point rendering if our context has been blown up!
        if (!this.gl || this.gl.isContextLost())
        {
            return;
        }

        this._nextTextureLocation = 0;

        if (!renderTexture)
        {
            this._lastObjectRendered = displayObject;
        }

        if (!skipUpdateTransform)
        {
            // update the scene graph
            const cacheParent = displayObject.parent;

            displayObject.parent = this._tempDisplayObjectParent;
            displayObject.updateTransform();
            displayObject.parent = cacheParent;
           // displayObject.hitArea = //TODO add a temp hit area
        }

        this.renderTexture.bind(renderTexture);

        this.currentRenderer.start();

        if (clear !== undefined ? clear : this.clearBeforeRender)
        {
            this.renderTexture.clear();
        }

        displayObject.renderWebGL(this);

        // apply transform..
        this.currentRenderer.flush();

        // this.setObjectRenderer(this.emptyRenderer);

        this.textureGC.update();

        this.gl.flush();

        this.emit('postrender');
    }

    /**
     * Changes the current renderer to the one given in parameter
     *
     * @param {PIXI.ObjectRenderer} objectRenderer - The object renderer to use.
     */
    setObjectRenderer(objectRenderer)
    {
        if (this.currentRenderer === objectRenderer)
        {
            return;
        }

        this.currentRenderer.stop();
        this.currentRenderer = objectRenderer;
        this.state.setState(objectRenderer.state);

        this.currentRenderer.start();
    }

    /**
     * This should be called if you wish to do some custom rendering
     * It will basically render anything that may be batched up such as sprites
     *
     */
    flush()
    {
        this.setObjectRenderer(this.emptyRenderer);
    }

    /**
     * Resizes the webGL view to the specified width and height.
     *
     * @param {number} screenWidth - the new width of the screen
     * @param {number} screenHeight - the new height of the screen
     */
    resize(screenWidth, screenHeight)
    {
      //  if(width * this.resolution === this.width && height * this.resolution === this.height)return;

        SystemRenderer.prototype.resize.call(this, screenWidth, screenHeight);

        this.renderTexture.resize(screenWidth, screenHeight);
    }

    /**
     * Sets the transform of the active render target to the given matrix
     *
     * @param {PIXI.Matrix} matrix - The transformation matrix
     */
    setTransform(matrix)
    {
        this._activeRenderTarget.transform = matrix;
    }

    /**
     * Binds the texture. This will return the location of the bound texture.
     * It may not be the same as the one you pass in. This is due to optimisation that prevents
     * needless binding of textures. For example if the texture is already bound it will return the
     * current location of the texture instead of the one provided. To bypass this use force location
     *
     * @param {PIXI.Texture} texture - the new texture
     * @param {number} location - the suggested texture location
     * @param {boolean} forceLocation - force the location
     * @return {PIXI.WebGLRenderer} Returns itself.
     */
    bindTexture(texture, location, forceLocation)
    {
        texture = texture || this.emptyTextures[location];
        texture = texture.baseTexture || texture;
        texture.touched = this.textureGC.count;

        if (!forceLocation)
        {
            // TODO - maybe look into adding boundIds.. save us the loop?
            for (let i = 0; i < this.boundTextures.length; i++)
            {
                if (this.boundTextures[i] === texture)
                {
                    return i;
                }
            }

            if (location === undefined)
            {
                this._nextTextureLocation++;
                this._nextTextureLocation %= this.boundTextures.length;
                location = this.boundTextures.length - this._nextTextureLocation - 1;
            }
        }
        else
        {
            location = location || 0;
        }

        const gl = this.gl;
        let glTexture = texture._glTextures[this.CONTEXT_UID];

        if(texture._newTexture)
        {
            this.newTextureManager.bindTexture(texture._newTexture, location);
            glTexture = texture._newTexture.glTextures[this.CONTEXT_UID];

            return location;
        }

        if (!glTexture)
        {
            // this will also bind the texture..
            this.textureManager.updateTexture(texture, location);
        }
        else
        {
            if (this.boundTextures[location] === texture)
            {
                return location;
            }

            this.boundTextures[location] = texture;
            gl.activeTexture(gl.TEXTURE0 + location);
            gl.bindTexture(gl.TEXTURE_2D, glTexture.texture);
        }

        return location;
    }

     /**
     * unbinds the texture ...
     *
     * @param {PIXI.Texture} texture - the texture to unbind
     * @return {PIXI.WebGLRenderer} Returns itself.
     */
    unbindTexture(texture)
    {
        const gl = this.gl;

        texture = texture.baseTexture || texture;

        for (let i = 0; i < this.boundTextures.length; i++)
        {
            if (this.boundTextures[i] === texture)
            {
                this.boundTextures[i] = this.emptyTextures[i];

                gl.activeTexture(gl.TEXTURE0 + i);
                gl.bindTexture(gl.TEXTURE_2D, this.emptyTextures[i]._glTextures[this.CONTEXT_UID].texture);
            }
        }

        return this;
    }

    /**
     * Creates a new VAO from this renderer's context and state.
     *
     * @return {VertexArrayObject} The new VAO.
     */
    createVao()
    {
        return new glCore.VertexArrayObject(this.gl, this.state.attribState);
    }

    /**
     * Changes the current Vao to the one given in parameter
     *
     * @param {PIXI.VertexArrayObject} vao - the new Vao
     * @return {PIXI.WebGLRenderer} Returns itself.
     */
    bindVao(vao)
    {
        if (this._activeVao === vao)
        {
            return this;
        }

        if (vao)
        {
            vao.bind();
        }
        else if (this._activeVao)
        {
            // TODO this should always be true i think?
            this._activeVao.unbind();
        }

        this._activeVao = vao;

        return this;
    }

    /**
     * Resets the WebGL state so you can render things however you fancy!
     *
     * @return {PIXI.WebGLRenderer} Returns itself.
     */
    reset()
    {
        this.setObjectRenderer(this.emptyRenderer);

        this._activeShader = null;
        this._activeRenderTarget = this.rootRenderTarget;

        // bind the main frame buffer (the screen);
        this.rootRenderTarget.activate();

        this.state.resetToDefault();

        return this;
    }

    /**
     * Handles a lost webgl context
     *
     * @private
     * @param {WebGLContextEvent} event - The context lost event.
     */
    handleContextLost(event)
    {
        event.preventDefault();
    }

    /**
     * Handles a restored webgl context
     *
     * @private
     */
    handleContextRestored()
    {
        this._initContext();
        this.textureManager.removeAll();
    }

    /**
     * Removes everything from the renderer (event listeners, spritebatch, etc...)
     *
     * @param {boolean} [removeView=false] - Removes the Canvas element from the DOM.
     *  See: https://github.com/pixijs/pixi.js/issues/2233
     */
    destroy(removeView)
    {
        this.destroyPlugins();

        // remove listeners
        this.view.removeEventListener('webglcontextlost', this.handleContextLost);
        this.view.removeEventListener('webglcontextrestored', this.handleContextRestored);

        this.textureManager.destroy();

        // call base destroy
        super.destroy(removeView);

        this.uid = 0;

        // destroy the managers
        this.maskManager.destroy();
        this.stencilManager.destroy();
        this.filterManager.destroy();

        this.maskManager = null;
        this.filterManager = null;
        this.textureManager = null;
        this.currentRenderer = null;

        this.handleContextLost = null;
        this.handleContextRestored = null;

        this._contextOptions = null;
        this.gl.useProgram(null);

        if (this.gl.getExtension('WEBGL_lose_context'))
        {
            this.gl.getExtension('WEBGL_lose_context').loseContext();
        }

        this.gl = null;

        // this = null;
    }
}

pluginTarget.mixin(WebGLRenderer);
