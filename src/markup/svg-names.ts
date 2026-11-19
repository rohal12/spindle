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

const ATTRIBUTES = `id class style lang tabindex role autofocus
accent-height accumulate additive alignment-baseline alphabetic amplitude
arabic-form ascent azimuth baseline-shift bbox begin bias by clip
clip-path clip-rule color color-interpolation color-interpolation-filters
color-profile color-rendering contentscripttype contentstyletype cursor
cx cy d decelerate descent direction display divisor dominant-baseline dur dx dy
elevation enable-background end exponent externalresourcesrequired fill
fill-opacity fill-rule filter flood-color flood-opacity focusable font-family
font-size font-size-adjust font-stretch font-style font-variant font-weight
format from fr fx fy g1 g2 glyph-name glyph-orientation-horizontal
glyph-orientation-vertical hanging height horiz-adv-x horiz-origin-x href
ideographic image-rendering in in2 intercept k k1 k2 k3 k4 kerning
letter-spacing lighting-color local marker-end marker-mid marker-start
mathematical max media method min mode name offset opacity operator order orient
orientation origin overflow overline-position overline-thickness panose-1
paint-order pointer-events points r radius rendering-intent restart result
rotate rx ry scale seed shape-rendering slope spacing speed stemh stemv
stop-color stop-opacity strikethrough-position strikethrough-thickness string
stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin
stroke-miterlimit stroke-opacity stroke-width target text-anchor
text-decoration text-overflow text-rendering to transform transform-origin type u1 u2
underline-position underline-thickness unicode unicode-bidi unicode-range
units-per-em v-alphabetic v-hanging v-ideographic v-mathematical values
vector-effect version vert-adv-y vert-origin-x vert-origin-y visibility width
widths word-spacing writing-mode x x-height x1 x2 xlink:actuate xlink:arcrole
xlink:href xlink:role xlink:show xlink:title xlink:type xml:base xml:lang xml:space
xmlns xmlns:xlink y y1 y2 z
attributeName attributeType baseFrequency baseProfile calcMode
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
  const lower = name.toLowerCase();
  return (
    attributes.get(lower) ?? (/^(?:aria-|data-)/.test(lower) ? lower : name)
  );
}
