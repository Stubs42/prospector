import { simulate } from "../engine/index.js";
const s = simulate({ games: 20, colours: ["black","red","blue","white"], seed: 1 });
console.log(JSON.stringify(s, null, 2));
