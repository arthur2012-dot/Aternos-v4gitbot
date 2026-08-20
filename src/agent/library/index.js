export * as skills from './skills.js';
export * as world from './world.js';
export * as pure_state from './full_state.js';

import * as skills from './skills.js';
import * as world from './world.js';
import * as pure_state from './full_state.js';

export function docToSkill(docstring) {
    return skills.docToSkill(docstring);
}

export default {
    skills,
    world,
    pure_state,
};
