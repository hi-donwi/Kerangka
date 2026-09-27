/**
 * Kerangka K1 Expression Parser
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { Lexer } from "./lexer.js";
import {
  ExprNode,
  K1SyntaxError,
  Token,
  TokenType,
} from "./types.js";

const MAX_DEPTH = 64;
const MAX_NODES = 100;

export class Parser {
  private readonly tokens: Token[];
  private current = 0;
  private depth = 0;
  private nodeCount = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  static parse(source: string): ExprNode {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    return parser.parseExpression();
  }

  parseExpression(): ExprNode {
    this.depth = 0;
    this.nodeCount = 0;
    const node = this.parseLogicalOr();

    if (!this.isAtEnd()) {
      const tok = this.peek();
      throw new K1SyntaxError(
        `Unexpected token '${tok.value}' after expression`,
        "UNEXPECTED_TRAILING_TOKEN",
        tok.start
      );
    }

    return node;
  }

  private trackNode<T extends ExprNode>(node: T): T {
    this.nodeCount++;
    if (this.nodeCount > MAX_NODES) {
      throw new K1SyntaxError(
        `Expression exceeds maximum complexity limit of ${MAX_NODES} AST nodes`,
        "EXPRESSION_TOO_COMPLEX",
        this.peek().start
      );
    }
    return node;
  }

  private enterDepth(): void {
    this.depth++;
    if (this.depth > MAX_DEPTH) {
      throw new K1SyntaxError(
        `Expression exceeds maximum tree depth of ${MAX_DEPTH}`,
        "EXPRESSION_TOO_DEEP",
        this.peek().start
      );
    }
  }

  private leaveDepth(): void {
    this.depth--;
  }

  // LogicalOr ::= LogicalAnd { "||" LogicalAnd }
  private parseLogicalOr(): ExprNode {
    this.enterDepth();
    try {
      let left = this.parseLogicalAnd();
      while (this.matchOperator("||")) {
        const op = this.previous().value;
        const right = this.parseLogicalAnd();
        left = this.trackNode({ $expr: op, args: [left, right] });
      }
      return left;
    } finally {
      this.leaveDepth();
    }
  }

  // LogicalAnd ::= Equality { "&&" Equality }
  private parseLogicalAnd(): ExprNode {
    this.enterDepth();
    try {
      let left = this.parseEquality();
      while (this.matchOperator("&&")) {
        const op = this.previous().value;
        const right = this.parseEquality();
        left = this.trackNode({ $expr: op, args: [left, right] });
      }
      return left;
    } finally {
      this.leaveDepth();
    }
  }

  // Equality ::= Relational { ( "==" | "!=" ) Relational }
  private parseEquality(): ExprNode {
    this.enterDepth();
    try {
      let left = this.parseRelational();
      while (this.matchOperator("==") || this.matchOperator("!=")) {
        const op = this.previous().value;
        const right = this.parseRelational();
        left = this.trackNode({ $expr: op, args: [left, right] });
      }
      return left;
    } finally {
      this.leaveDepth();
    }
  }

  // Relational ::= Additive { ( "<" | "<=" | ">" | ">=" ) Additive }
  private parseRelational(): ExprNode {
    this.enterDepth();
    try {
      let left = this.parseAdditive();
      while (
        this.matchOperator("<") ||
        this.matchOperator("<=") ||
        this.matchOperator(">") ||
        this.matchOperator(">=")
      ) {
        const op = this.previous().value;
        const right = this.parseAdditive();
        left = this.trackNode({ $expr: op, args: [left, right] });
      }
      return left;
    } finally {
      this.leaveDepth();
    }
  }

  // Additive ::= Multiplicative { ( "+" | "-" ) Multiplicative }
  private parseAdditive(): ExprNode {
    this.enterDepth();
    try {
      let left = this.parseMultiplicative();
      while (this.matchOperator("+") || this.matchOperator("-")) {
        const op = this.previous().value;
        const right = this.parseMultiplicative();
        left = this.trackNode({ $expr: op, args: [left, right] });
      }
      return left;
    } finally {
      this.leaveDepth();
    }
  }

  // Multiplicative ::= Unary { ( "*" | "/" | "%" ) Unary }
  private parseMultiplicative(): ExprNode {
    this.enterDepth();
    try {
      let left = this.parseUnary();
      while (
        this.matchOperator("*") ||
        this.matchOperator("/") ||
        this.matchOperator("%")
      ) {
        const op = this.previous().value;
        const right = this.parseUnary();
        left = this.trackNode({ $expr: op, args: [left, right] });
      }
      return left;
    } finally {
      this.leaveDepth();
    }
  }

  // Unary ::= ( "!" | "-" ) Unary | Primary
  private parseUnary(): ExprNode {
    this.enterDepth();
    try {
      if (this.matchOperator("!") || this.matchOperator("-")) {
        const op = this.previous().value;
        const operand = this.parseUnary();
        return this.trackNode({ $expr: op, args: [operand] });
      }
      return this.parsePrimary();
    } finally {
      this.leaveDepth();
    }
  }

  // Primary ::= Literal | FunctionCall | Grouping | Path
  private parsePrimary(): ExprNode {
    const tok = this.peek();

    // Grouping: "(" Expression ")"
    if (this.matchPunctuation("(")) {
      const expr = this.parseLogicalOr();
      this.consumePunctuation(")", "Expected ')' after grouped expression");
      return expr;
    }

    // Literals
    if (tok.type === "NULL") {
      this.advance();
      return this.trackNode({ literal: null });
    }

    if (tok.type === "BOOLEAN") {
      this.advance();
      return this.trackNode({ literal: tok.literalValue as boolean });
    }

    if (tok.type === "NUMBER") {
      this.advance();
      return this.trackNode({ literal: tok.literalValue as number });
    }

    if (tok.type === "STRING") {
      this.advance();
      return this.trackNode({ literal: tok.literalValue as string });
    }

    // Identifier: could be FunctionCall or Path
    if (tok.type === "IDENTIFIER") {
      // Check if followed by "(" -> FunctionCall
      if (this.peekNext().type === "PUNCTUATION" && this.peekNext().value === "(") {
        return this.parseFunctionCall();
      }
      // Otherwise, parse as Path
      return this.parsePath();
    }

    throw new K1SyntaxError(
      `Unexpected token '${tok.value}' in expression`,
      "UNEXPECTED_TOKEN",
      tok.start
    );
  }

  // FunctionCall ::= Identifier "(" [ ArgumentList ] ")"
  private parseFunctionCall(): ExprNode {
    const idToken = this.consume("IDENTIFIER", "Expected function name");
    this.consumePunctuation("(", "Expected '(' after function name");

    const args: ExprNode[] = [];
    if (!this.checkPunctuation(")")) {
      do {
        args.push(this.parseLogicalOr());
      } while (this.matchPunctuation(","));
    }

    this.consumePunctuation(")", "Expected ')' after function arguments");
    return this.trackNode({ $expr: idToken.value, args });
  }

  // Path ::= Identifier { ( "." Identifier ) | Indexer }
  // Indexer ::= "[" ( IntegerLiteral | StringLiteral ) "]"
  private parsePath(): ExprNode {
    const rootToken = this.consume("IDENTIFIER", "Expected path identifier");
    let path = rootToken.value;

    while (true) {
      if (this.matchPunctuation(".")) {
        const segment = this.consume("IDENTIFIER", "Expected identifier after '.' in path");
        path += `.${segment.value}`;
      } else if (this.matchPunctuation("[")) {
        const indexToken = this.peek();
        if (indexToken.type === "NUMBER" && !indexToken.value.includes(".")) {
          this.advance();
          this.consumePunctuation("]", "Expected ']' after index in path");
          path += `[${indexToken.value}]`;
        } else if (indexToken.type === "STRING") {
          this.advance();
          this.consumePunctuation("]", "Expected ']' after index in path");
          path += `['${indexToken.literalValue}']`;
        } else {
          throw new K1SyntaxError(
            `Expected integer or string literal index inside '[...]', got '${indexToken.value}'`,
            "INVALID_PATH_INDEX",
            indexToken.start
          );
        }
      } else {
        break;
      }
    }

    return this.trackNode({ $bind: path });
  }

  private matchOperator(op: string): boolean {
    if (this.checkOperator(op)) {
      this.advance();
      return true;
    }
    return false;
  }

  private checkOperator(op: string): boolean {
    if (this.isAtEnd()) return false;
    const tok = this.peek();
    return tok.type === "OPERATOR" && tok.value === op;
  }

  private matchPunctuation(p: string): boolean {
    if (this.checkPunctuation(p)) {
      this.advance();
      return true;
    }
    return false;
  }

  private checkPunctuation(p: string): boolean {
    if (this.isAtEnd()) return false;
    const tok = this.peek();
    return tok.type === "PUNCTUATION" && tok.value === p;
  }

  private consume(type: TokenType, errorMessage: string): Token {
    if (this.checkType(type)) return this.advance();
    const tok = this.peek();
    throw new K1SyntaxError(errorMessage, "UNEXPECTED_TOKEN", tok.start);
  }

  private consumePunctuation(p: string, errorMessage: string): Token {
    if (this.checkPunctuation(p)) return this.advance();
    const tok = this.peek();
    throw new K1SyntaxError(errorMessage, "EXPECTED_PUNCTUATION", tok.start);
  }

  private checkType(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private isAtEnd(): boolean {
    return this.peek().type === "EOF";
  }

  private peek(): Token {
    return this.tokens[this.current] ?? {
      type: "EOF",
      value: "",
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
    };
  }

  private peekNext(): Token {
    return this.tokens[this.current + 1] ?? {
      type: "EOF",
      value: "",
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
    };
  }

  private previous(): Token {
    return this.tokens[this.current - 1] ?? {
      type: "EOF",
      value: "",
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
    };
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }
}
