// A tiny recursive-descent parser/evaluator for simple math expressions
// like "sin(x) * exp(-x^2)". Used for `plot` blocks' function series.
//
// Deliberately NOT eval()/new Function() — the expression string comes
// from AI output, which this project treats as untrusted. This evaluator
// has no access to any JS global, the DOM, or anything beyond the fixed
// set of math functions/constants below, and it has no way to call back
// into arbitrary code, so there's nothing here for hostile input to reach.

const CONSTANTS = { pi: Math.PI, e: Math.E };
const FUNCTIONS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  exp: Math.exp, log: Math.log, log2: Math.log2, log10: Math.log10,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  min: Math.min, max: Math.max, pow: Math.pow,
};

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.eE]/.test(src[j])) {
        // allow exponent sign, e.g. 1e-10
        if ((src[j] === "e" || src[j] === "E") && (src[j + 1] === "+" || src[j + 1] === "-")) j++;
        j++;
      }
      tokens.push({ type: "num", value: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      tokens.push({ type: "ident", value: src.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/^(),".includes(c)) {
      tokens.push({ type: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}" in expression.`);
  }
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }
  peek() { return this.tokens[this.pos]; }
  next() { return this.tokens[this.pos++]; }
  expect(type) {
    const t = this.next();
    if (!t || t.type !== type) throw new Error(`Expected "${type}" in expression.`);
    return t;
  }

  parseExpression() { return this.parseAddSub(); }

  parseAddSub() {
    let left = this.parseMulDiv();
    while (this.peek() && (this.peek().type === "+" || this.peek().type === "-")) {
      const op = this.next().type;
      const right = this.parseMulDiv();
      left = { op, left, right };
    }
    return left;
  }

  parseMulDiv() {
    let left = this.parseUnary();
    while (this.peek() && (this.peek().type === "*" || this.peek().type === "/")) {
      const op = this.next().type;
      const right = this.parseUnary();
      left = { op, left, right };
    }
    return left;
  }

  parseUnary() {
    if (this.peek() && (this.peek().type === "-" || this.peek().type === "+")) {
      const op = this.next().type;
      return { op: "unary" + op, value: this.parseUnary() };
    }
    return this.parsePower();
  }

  parsePower() {
    const base = this.parsePrimary();
    if (this.peek() && this.peek().type === "^") {
      this.next();
      const exp = this.parseUnary(); // right-associative, allows -x^2
      return { op: "^", left: base, right: exp };
    }
    return base;
  }

  parsePrimary() {
    const t = this.peek();
    if (!t) throw new Error("Unexpected end of expression.");
    if (t.type === "num") { this.next(); return { op: "num", value: t.value }; }
    if (t.type === "(") {
      this.next();
      const inner = this.parseExpression();
      this.expect(")");
      return inner;
    }
    if (t.type === "ident") {
      this.next();
      const name = t.value;
      if (this.peek() && this.peek().type === "(") {
        this.next();
        const args = [];
        if (this.peek() && this.peek().type !== ")") {
          args.push(this.parseExpression());
          while (this.peek() && this.peek().type === ",") {
            this.next();
            args.push(this.parseExpression());
          }
        }
        this.expect(")");
        return { op: "call", name, args };
      }
      return { op: "var", name };
    }
    throw new Error(`Unexpected token in expression.`);
  }
}

function evalNode(node, scope) {
  switch (node.op) {
    case "num": return node.value;
    case "var": {
      const key = node.name.toLowerCase();
      if (key in scope) return scope[key];
      if (key in CONSTANTS) return CONSTANTS[key];
      throw new Error(`Unknown variable "${node.name}".`);
    }
    case "call": {
      const fn = FUNCTIONS[node.name.toLowerCase()];
      if (!fn) throw new Error(`Unknown function "${node.name}".`);
      return fn(...node.args.map((a) => evalNode(a, scope)));
    }
    case "+": return evalNode(node.left, scope) + evalNode(node.right, scope);
    case "-": return evalNode(node.left, scope) - evalNode(node.right, scope);
    case "*": return evalNode(node.left, scope) * evalNode(node.right, scope);
    case "/": return evalNode(node.left, scope) / evalNode(node.right, scope);
    case "^": return Math.pow(evalNode(node.left, scope), evalNode(node.right, scope));
    case "unary-": return -evalNode(node.value, scope);
    case "unary+": return evalNode(node.value, scope);
    default: throw new Error("Malformed expression.");
  }
}

/** Compiles an expression once into a fast `(scope) => number` function. */
export function compileExpression(src) {
  const ast = new Parser(tokenize(src)).parseExpression();
  return (scope = {}) => evalNode(ast, scope);
}
