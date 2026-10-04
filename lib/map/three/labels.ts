import * as T from 'three';
import type { PlacedLabel } from '../labels';

const quad = new T.PlaneGeometry(1, 1);
type Sprite = { mesh: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>; key: string };

/**
 * Boat names drawn by the 3D renderer, over the scene in screen pixels: about one draw call
 * each, in the same frame as the boats (no extra canvas or DOM layer to composite).
 * Bitmaps are rendered at the device's full 3D pixel ratio, so they stay sharp and never re-render
 * when the adaptive resolution changes.
 */
export class LabelSprites {
  readonly scene = new T.Scene();
  readonly camera = new T.OrthographicCamera(0, 1, 0, -1, -1, 1);
  private sprites = new Map<string, Sprite>();

  resize(width: number, height: number) {
    if (this.camera.right === width && this.camera.bottom === -height) return;
    this.camera.right = width; this.camera.bottom = -height; this.camera.updateProjectionMatrix();
  }

  update(placed: PlacedLabel[], pixelRatio: number) {
    const seen = new Set<string>();
    placed.forEach((label, order) => {
      seen.add(label.id);
      let sprite = this.sprites.get(label.id);
      if (!sprite) {
        const material = new T.MeshBasicMaterial({transparent: true, depthTest: false, depthWrite: false, toneMapped: false});
        sprite = {mesh: new T.Mesh(quad, material), key: ''};
        sprite.mesh.frustumCulled = false;
        this.scene.add(sprite.mesh); this.sprites.set(label.id, sprite);
      }
      const {mesh} = sprite;
      if (sprite.key !== label.key) {
        mesh.material.map?.dispose();
        const texture = new T.CanvasTexture(label.bitmap);
        // Drawn at the device's full ratio; mipmaps keep it clean when the scene renders smaller.
        texture.colorSpace = T.SRGBColorSpace; texture.minFilter = T.LinearMipmapLinearFilter; texture.magFilter = T.LinearFilter;
        mesh.material.map = texture; mesh.material.needsUpdate = true; sprite.key = label.key;
      }
      const w = label.bitmap.width / pixelRatio, h = label.bitmap.height / pixelRatio;
      // Sub-pixel position, like the boat it follows: snapping to the scene's pixel grid made a
      // moving name step by ~1.6 screen pixels at a time, a visible jitter.
      mesh.scale.set(w, h, 1);
      mesh.position.set(label.x + w / 2, -(label.y + h / 2), 0);
      mesh.material.opacity = label.alpha;
      mesh.renderOrder = order;
      mesh.visible = true;
    });
    // Faded out: hidden but kept, it usually comes back (released in prune when its boat leaves).
    for (const [id, sprite] of this.sprites) if (!seen.has(id)) sprite.mesh.visible = false;
  }

  private remove(id: string) {
    const sprite = this.sprites.get(id); if (!sprite) return;
    this.scene.remove(sprite.mesh); sprite.mesh.material.map?.dispose(); sprite.mesh.material.dispose(); this.sprites.delete(id);
  }

  /** Drop sprites of boats that left the race. */
  prune(ids: Set<string>) { for (const id of [...this.sprites.keys()]) if (!ids.has(id)) this.remove(id); }

  dispose() { for (const id of [...this.sprites.keys()]) this.remove(id); }
}
