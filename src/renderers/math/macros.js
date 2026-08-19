// Extra LaTeX macros layered on top of core KaTeX, so the model can use
// braket/quantum notation and common SI units without a separate fenced
// block type or a full TeX distribution. These are plain KaTeX macros
// (text substitution with positional args), not a real implementation of
// braket.sty or siunitx — see the notes below for what that means in
// practice.
//
// KaTeX already covers amsmath/amssymb-equivalent syntax natively (\frac,
// \sum, \int, matrices, \mathbb, \mathcal, aligned environments, etc.), so
// nothing extra is needed there.

export const KATEX_MACROS = {
  // ---- braket / Dirac quantum notation ----
  // \braket{\phi|\psi} is the standard lightweight approximation of
  // braket.sty: the caller writes the bar themselves, this just wraps it
  // in angle brackets sized to the content. It reads correctly for the
  // vast majority of real usage (kets, bras, inner products, expectation
  // values) without needing braket.sty's argument-splitting logic.
  "\\ket": "\\left|#1\\right\\rangle",
  "\\bra": "\\left\\langle#1\\right|",
  "\\braket": "\\left\\langle#1\\right\\rangle",
  "\\ketbra": "\\left|#1\\right\\rangle\\!\\left\\langle#2\\right|",
  "\\expval": "\\left\\langle#1\\right\\rangle",
  "\\ip": "\\left\\langle#1\\middle|#2\\right\\rangle",

  // ---- siunitx-style subset ----
  // Real siunitx parses unit strings and reformats numbers (scientific
  // notation, uncertainty, locale-aware separators). That parser isn't
  // reimplemented here — \qty/\si instead just typeset their arguments in
  // upright text with correct spacing, which covers the common textbook
  // case ("\qty{9.8}{m/s^2}") without pulling in a unit-parsing engine.
  "\\num": "{#1}",
  "\\si": "\\mathrm{#1}",
  "\\qty": "#1\\,\\mathrm{#2}",
  "\\SI": "#1\\,\\mathrm{#2}",
  "\\ang": "#1^{\\circ}",

  // Common SI unit names, usable directly (\meter) or after a prefix
  // (\kilo\gram) — prefixes and names are separate macros that simply sit
  // next to each other, e.g. \kilo\gram renders as "kg".
  "\\meter": "\\mathrm{m}", "\\metre": "\\mathrm{m}",
  "\\gram": "\\mathrm{g}",
  "\\second": "\\mathrm{s}",
  "\\ampere": "\\mathrm{A}",
  "\\kelvin": "\\mathrm{K}",
  "\\mole": "\\mathrm{mol}",
  "\\candela": "\\mathrm{cd}",
  "\\hertz": "\\mathrm{Hz}",
  "\\newton": "\\mathrm{N}",
  "\\pascal": "\\mathrm{Pa}",
  "\\joule": "\\mathrm{J}",
  "\\watt": "\\mathrm{W}",
  "\\coulomb": "\\mathrm{C}",
  "\\volt": "\\mathrm{V}",
  "\\ohm": "\\Omega",
  "\\farad": "\\mathrm{F}",
  "\\henry": "\\mathrm{H}",
  "\\tesla": "\\mathrm{T}",
  "\\weber": "\\mathrm{Wb}",
  "\\lumen": "\\mathrm{lm}",
  "\\lux": "\\mathrm{lx}",
  "\\radian": "\\mathrm{rad}",
  "\\steradian": "\\mathrm{sr}",
  "\\per": "/",
  "\\squared": "^2",
  "\\cubed": "^3",

  // Metric prefixes
  "\\kilo": "\\mathrm{k}", "\\milli": "\\mathrm{m}", "\\micro": "\\mu{}",
  "\\nano": "\\mathrm{n}", "\\pico": "\\mathrm{p}", "\\centi": "\\mathrm{c}",
  "\\deci": "\\mathrm{d}", "\\mega": "\\mathrm{M}", "\\giga": "\\mathrm{G}",
};
