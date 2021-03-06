import * as utils from './utils.js';
import * as _ from 'lodash';

class Animation {
  constructor(
    mobject,
    rateFunc=utils.smooth,
    lagRatio=0,
    runtime=1,
  ) {
    this.mobject = mobject;
    this.rateFunc = rateFunc;
    this.lagRatio = lagRatio;
    this.runtime = runtime;
  }

  /* This is called right as an animation is being
   * played.  As much initialization as possible,
   * especially any mobject copying, should live in
   * this method.
   */
  begin() {
    this.startingMobject = this.createStartingMobject();
    if (this.suspendMobjectUpdating) {
      // All calls to self.mobject's internal updaters
      // during the animation, either from this Animation
      // or from the surrounding scene, should do nothing.
      // It is, however, okay and desirable to call
      // the internal updaters of self.starting_mobject,
      // or any others among self.get_all_mobjects()
      this.mobject.suspendUpdating();
    }
    this.interpolate(0);
  }

  /* On each frame of the Animation, each Mobject in the top-level Mobject's
   * heirarchy will be passed to interpolateSubmobject. Depending on the
   * Animation, the Mobjects may be passed together with some other Mobjects
   * which will serve to parameterize the interpolation. For each parameterizing
   * Mobject, the Animation must provide a "copy" Mobject with whose heirarchy
   * is one-to-one with that of its input Mobject. These copies will be
   * decomposed into the arguments to interpolateSubmobject.
   */
  getCopiesForInterpolation() {
    return [this.mobject];
  }

  interpolate(alpha) {
    if (alpha < 0) {
      alpha = 0;
    } else if (alpha > 1) {
      alpha = 1;
    }
    this.interpolateMobject(this.rateFunc(alpha));
  }

  interpolateMobject(alpha) {
    /* A list of arguments to interpolateSubmobject() for each Mobject in the
     * heirarchy which contains a top-level path (i.e. those that don't function
     * only as Groups).
     */
    let interpolateSubmobjectArgs = this.getAllArgsToInterpolateSubmobject();
    for (let i = 0; i < interpolateSubmobjectArgs.length; i++) {
      let subAlpha = this.getSubAlpha(alpha, i, interpolateSubmobjectArgs.length);
      this.interpolateSubmobject(subAlpha, ...interpolateSubmobjectArgs[i]);
    }
  }

  /* For each Mobject which is in the heirarchy of the one being animated and
   * has points, returns a list containing the Mobject along with any
   * parameterizing Mobjects necessary to interpolate it. Each of these lists
   * will have their Mobjects passed to interpolateSubmobject. For Transforms
   * this will be
   * [
   *   [submob1, starting_sumobject1, target_submobject1],
   *   [submob2, starting_sumobject2, target_submobject2],
   *   [submob3, starting_sumobject3, target_submobject3],
   * ]
   */
  getAllArgsToInterpolateSubmobject() {
    let mobjectHeirarchies = [];
    for (let mobjectCopy of this.getCopiesForInterpolation()) {
      let heirarchy = mobjectCopy.getMobjectHeirarchy();
      let heirarchyMembersWithPoints = heirarchy.filter(
        submob => submob.points().length > 0
      );
      mobjectHeirarchies.push(heirarchyMembersWithPoints);
    }
    let argsList = [];
    for (let i = 0; i < mobjectHeirarchies[0].length; i++) {
      argsList.push(mobjectHeirarchies.map(h => h[i]));
    }
    return argsList;
  }

  /* In order to stagger the start times of animations for multiple Mobjects,
   * have the Mobject at index i begin its animation at a proportion
   * this.lagRatio * i * alpha from the start of the Animation.
   */
  getSubAlpha(alpha, index, numSubmobjects) {
    // eslint-disable-next-line
    console.assert(0 <= alpha && alpha <= 1);
    let fullRuntime = (numSubmobjects - 1) * this.lagRatio + 1;
    let fullRuntimeAlpha = fullRuntime * alpha;
    let startTime = this.lagRatio * index;
    let endTime = startTime + 1;
    if (fullRuntimeAlpha <= startTime) {
      return 0;
    } else if (endTime <= fullRuntimeAlpha) {
      return 1;
    } else {
      return fullRuntimeAlpha - startTime;
    }
  }

  isFinished(alpha) {
    return alpha >= 1;
  }

  createStartingMobject() {
    return this.mobject.clone();
  }

  static interpolateSubmobject() {
    // eslint-disable-next-line
    console.error(`${this.name} does not override interpolateSubmobject()`);
  }

  static getDiff() {
    // eslint-disable-next-line
    console.error(`${this.name} does not override getDiff()`);
  }
}

class ReplacementTransform extends Animation {
  constructor(mobject, targetMobject) {
    super(mobject);
    this.targetMobject = targetMobject;
  }

  begin() {
    // Use a copy of targetMobject for the alignData
    // call so that the actual targetMobject is
    // preserved.
    this.targetCopy = this.targetMobject.clone()
    // Note, this potentially changes the structure
    // of both this.mobject and this.targetMobject
    this.mobject.alignData(this.targetCopy);
    Animation.prototype.begin.call(this)
  }

  getCopiesForInterpolation() {
    return [this.mobject, this.startingMobject, this.targetCopy];
  }

  interpolateSubmobject(alpha, submob, start, targetCopy) {
    submob.interpolate(start, targetCopy, alpha);
  }

  static getDiff(mobject, targetMobject) {
    return {
      'add': [targetMobject],
      'remove': [mobject],
    };
  }
}

class ShowCreation extends Animation {
  interpolateSubmobject(alpha, submob, startingSubmobject) {
    if (alpha > 0) {
      submob.pointwiseBecomePartial(startingSubmobject, 0, alpha);
    }
  }

  getCopiesForInterpolation() {
    return [this.mobject, this.startingMobject];
  }

  static getDiff(mobject) {
    return {
      'add': [mobject],
    };
  }
}

// TODO: This should start with a thick stroke width then fade to a thin one
class Write extends Animation {
  constructor(mobject, runtime=null, lagRatio=null) {
    super(mobject, utils.linear, lagRatio, runtime);
    if (runtime === null || lagRatio === null) {
      this.setConfigFromLength(mobject.getMobjectHeirarchy().length);
    }
  }

  setConfigFromLength(length) {
    if (this.runtime === null) {
      if (length) {
        this.runtime = 1;
      } else {
        this.runtime = 2;
      }
    }
    if (this.lagRatio === null) {
      this.lagRatio = Math.min(4 / length, 0.2);
    }
  }

  begin() {
    this.mobject.applyStyle({ strokeWidth: 1, fillOpacity: 0 });
    Animation.prototype.begin.call(this);
    this.startingMobject.applyStyle({ fillOpacity: 0 });
  }

  interpolateSubmobject(alpha, submob, startingSubmobject) {
    if (alpha <= 0.5) {
      submob.pointwiseBecomePartial(startingSubmobject, 0, 2 * alpha);
    } else {
      if(!_.last(submob.children[0].vertices).equals(_.last(startingSubmobject.children[0].vertices))) {
        submob.pointwiseBecomePartial(startingSubmobject, 0, 1);
      }
      submob.applyStyle({ fillOpacity: 2 * alpha - 1 });
    }
  }

  getCopiesForInterpolation() {
    return [this.mobject, this.startingMobject];
  }

  static getDiff(mobject) {
    return {
      'add': [mobject],
    };
  }
}

// class ApplyPointwiseFunction extends Animation {
//   constructor(func, mobject) {
//     super(mobject);
//     this.func = func;
//   }
// 
//   begin() {
//     console.log(this.mobject.path().vertices.slice(0, 4).map(v => [v.x, v.y]));
//     this.transformedMobject = this.mobject.clone();
//     console.log(this.mobject.path().vertices.slice(0, 4).map(v => [v.x, v.y]));
//     // this.transformedMobject.applyFunction(this.func);
//     // this.transformedMobject.path().vertices[0].x = 500;
//     console.log(this.mobject.path().vertices.slice(0, 4).map(v => [v.x, v.y]));
//     Animation.prototype.begin.call(this);
//   }
// 
//   interpolateSubmobject(alpha, submob, transformed) {
//     submob.interpolate(submob, transformed, alpha);
//   }
// 
//   getCopiesForInterpolation() {
//     return [this.mobject, this.transformedMobject];
//   }
// 
//   static getDiff() {
//     // TODO: Add modify diff
//     return {};
//   }
// }

class FadeIn extends Animation {
  interpolateSubmobject(alpha, mob, startingMob) {
    let style1 = startingMob.getStyleDict();
    let style2 = Object.assign({}, style1);
    style1.strokeOpacity = 0;
    style1.fillOpacity = 0;
    mob.applyStyle(utils.interpolateStyles(style1, style2, alpha));
  }

  getCopiesForInterpolation() {
    return [this.mobject, this.startingMobject];
  }

  static getDiff(mobject) {
    return {
      'add': [mobject],
    };
  }
}

class FadeOut extends Animation {
  interpolateMobject(alpha) {
    this.mobject.opacity = 1 - alpha;
  }

  static getDiff(mobject, mobjectData) {
    let ret = {
      remove: [mobject],
      modify: [],
    };
    for (let mobjectName of Object.keys(mobjectData)) {
      let data = mobjectData[mobjectName];
      if (data.submobjects.includes(mobject)) {
        ret['modify'].push([
          mobjectName,
          "remove " + mobject,
          "add " + mobject,
        ]);
      }
    }
    return ret;
  }
}

class Wait extends Animation {
  interpolateMobject() {}

  static getDiff() {
    return {};
  }

  createStartingMobject() {}
}

// Any Animation exported here must also be exported in manim.js before it can
// be imported.
export {
  Animation,
  Wait,
  ReplacementTransform,
  ShowCreation,
  // ApplyPointwiseFunction,
  Write,
  FadeOut,
  FadeIn,
}
