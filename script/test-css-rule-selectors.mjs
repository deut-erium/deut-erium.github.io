import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rulePreludes} from './css-rule-selectors.mjs';

test('groups, declarations and keyframe steps have distinct roles',()=>{
 const css='@charset "UTF-8"; @media (width > 300px) { a, b:hover { color:red; } @supports (display:grid) { .x {display:grid} } } @keyframes pulse { 0% {opacity:0} 100% {opacity:1} }';
 assert.deepEqual(rulePreludes(css).map(r=>r.prelude),['@media (width > 300px)','a, b:hover','@supports (display:grid)','.x','@keyframes pulse']);
});
test('comments, quoted delimiters and escapes do not create rules',()=>{
 const css='/* { */ [title="/*;{}"] { content:"}"; background:url("data:x;{a}"); }\n.x\\{y { content:"\\\""; }';
 assert.deepEqual(rulePreludes(css),[{prelude:'[title="/*;{}"]',line:1},{prelude:'.x\\{y',line:2}]);
});
test('unbalanced blocks, comments and strings fail closed',()=>{
 for(const css of ['/* no end','.x {','@media all { .x {}','}','.x {content:"no end}','.x'])assert.throws(()=>rulePreludes(css));
});
