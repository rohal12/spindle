/** HTML foreign-content name adjustments; unknown foreign names stay intact.
 * https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inforeign
 */
const TAGS = `svg a animate circle defs desc discard ellipse filter g image line
marker mask metadata mpath path pattern polygon polyline rect script set stop
style switch symbol text title tspan use view
altGlyph altGlyphDef altGlyphItem animateColor animateMotion
animateTransform clipPath feBlend feColorMatrix feComponentTransfer feComposite
feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow
feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode
feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile
feTurbulence foreignObject glyphRef linearGradient radialGradient textPath`;

const ATTRIBUTES = `attributeName attributeType baseFrequency baseProfile calcMode
clipPathUnits diffuseConstant edgeMode filterUnits glyphRef gradientTransform
gradientUnits kernelMatrix kernelUnitLength keyPoints keySplines keyTimes
lengthAdjust limitingConeAngle markerHeight markerUnits markerWidth
maskContentUnits maskUnits numOctaves pathLength patternContentUnits
patternTransform patternUnits pointsAtX pointsAtY pointsAtZ preserveAlpha
preserveAspectRatio primitiveUnits refX refY repeatCount repeatDur
requiredExtensions requiredFeatures specularConstant specularExponent
spreadMethod startOffset stdDeviation stitchTiles surfaceScale systemLanguage
tableValues targetX targetY textLength viewBox viewTarget xChannelSelector
yChannelSelector zoomAndPan`;

function adjustments(names: string): Map<string, string> {
  return new Map(names.split(/\s+/).map((name) => [name.toLowerCase(), name]));
}

const tags = adjustments(TAGS);
const attributes = adjustments(ATTRIBUTES);

export function svgTagName(name: string): string {
  return tags.get(name.toLowerCase()) ?? name;
}

export function svgAttributeName(name: string): string {
  return attributes.get(name.toLowerCase()) ?? name;
}
