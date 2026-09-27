/**
 * Kerangka K1 Expression Lexer
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { K1SyntaxError, SourceLocation, Token } from "./types.js";

export class Lexer {
  private readonly source: string;
  private offset = 0;
  private line = 1;
  private column = 1;

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (!this.isAtEnd()) {
      this.skipWhitespace();
      if (this.isAtEnd()) break;

      const ch = this.peek();
      const startLoc = this.currentLocation();

      // Number
      if (this.isDigit(ch)) {
        tokens.push(this.readNumber(startLoc));
        continue;
      }

      // String (single or double quote)
      if (ch === '"' || ch === "'") {
        tokens.push(this.readString(ch, startLoc));
        continue;
      }

      // Identifier or Keyword (null, true, false)
      if (this.isAlphaOrUnderscore(ch)) {
        tokens.push(this.readIdentifier(startLoc));
        continue;
      }

      // Multi-char or single-char operators
      if (ch === "|" && this.peekNext() === "|") {
        this.advance();
        this.advance();
        tokens.push({ type: "OPERATOR", value: "||", start: startLoc, end: this.currentLocation() });
        continue;
      }

      if (ch === "&" && this.peekNext() === "&") {
        this.advance();
        this.advance();
        tokens.push({ type: "OPERATOR", value: "&&", start: startLoc, end: this.currentLocation() });
        continue;
      }

      if (ch === "=" && this.peekNext() === "=") {
        this.advance();
        this.advance();
        tokens.push({ type: "OPERATOR", value: "==", start: startLoc, end: this.currentLocation() });
        continue;
      }

      if (ch === "!" && this.peekNext() === "=") {
        this.advance();
        this.advance();
        tokens.push({ type: "OPERATOR", value: "!=", start: startLoc, end: this.currentLocation() });
        continue;
      }

      if (ch === "<" && this.peekNext() === "=") {
        this.advance();
        this.advance();
        tokens.push({ type: "OPERATOR", value: "<=", start: startLoc, end: this.currentLocation() });
        continue;
      }

      if (ch === ">" && this.peekNext() === "=") {
        this.advance();
        this.advance();
        tokens.push({ type: "OPERATOR", value: ">=", start: startLoc, end: this.currentLocation() });
        continue;
      }

      // Single-character operators
      if ("+-*/%!<>==".includes(ch)) {
        this.advance();
        tokens.push({ type: "OPERATOR", value: ch, start: startLoc, end: this.currentLocation() });
        continue;
      }

      // Punctuation
      if ("()[],.".includes(ch)) {
        this.advance();
        tokens.push({ type: "PUNCTUATION", value: ch, start: startLoc, end: this.currentLocation() });
        continue;
      }

      throw new K1SyntaxError(
        `Unexpected character '${ch}' in expression`,
        "UNEXPECTED_CHARACTER",
        startLoc
      );
    }

    const endLoc = this.currentLocation();
    tokens.push({ type: "EOF", value: "", start: endLoc, end: endLoc });
    return tokens;
  }

  private isAtEnd(): boolean {
    return this.offset >= this.source.length;
  }

  private peek(): string {
    return this.source[this.offset] ?? "";
  }

  private peekNext(): string {
    return this.source[this.offset + 1] ?? "";
  }

  private advance(): string {
    const ch = this.source[this.offset] ?? "";
    this.offset++;
    if (ch === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private currentLocation(): SourceLocation {
    return {
      line: this.line,
      column: this.column,
      offset: this.offset,
    };
  }

  private skipWhitespace(): void {
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this.advance();
      } else {
        break;
      }
    }
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isAlphaOrUnderscore(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }

  private isAlphaNumeric(ch: string): boolean {
    return this.isAlphaOrUnderscore(ch) || this.isDigit(ch);
  }

  private readNumber(startLoc: SourceLocation): Token {
    let numStr = "";
    while (this.isDigit(this.peek())) {
      numStr += this.advance();
    }

    if (this.peek() === "." && this.isDigit(this.peekNext())) {
      numStr += this.advance(); // consume '.'
      while (this.isDigit(this.peek())) {
        numStr += this.advance();
      }
    }

    const numVal = Number(numStr);
    return {
      type: "NUMBER",
      value: numStr,
      literalValue: numVal,
      start: startLoc,
      end: this.currentLocation(),
    };
  }

  private readString(quote: string, startLoc: SourceLocation): Token {
    this.advance(); // consume opening quote
    let strVal = "";

    while (!this.isAtEnd() && this.peek() !== quote) {
      const ch = this.peek();
      if (ch === "\n" || ch === "\r") {
        throw new K1SyntaxError("Unterminated string literal in expression", "UNTERMINATED_STRING", startLoc);
      }

      if (ch === "\\") {
        this.advance(); // consume '\'
        if (this.isAtEnd()) {
          throw new K1SyntaxError("Unterminated escape sequence", "UNTERMINATED_ESCAPE", this.currentLocation());
        }
        const esc = this.advance();
        switch (esc) {
          case "b": strVal += "\b"; break;
          case "t": strVal += "\t"; break;
          case "n": strVal += "\n"; break;
          case "f": strVal += "\f"; break;
          case "r": strVal += "\r"; break;
          case '"': strVal += '"'; break;
          case "'": strVal += "'"; break;
          case "\\": strVal += "\\"; break;
          case "u": {
            let hex = "";
            for (let i = 0; i < 4; i++) {
              if (this.isAtEnd()) {
                throw new K1SyntaxError("Invalid unicode escape sequence in string", "INVALID_UNICODE_ESCAPE", this.currentLocation());
              }
              hex += this.advance();
            }
            strVal += String.fromCharCode(parseInt(hex, 16));
            break;
          }
          default:
            strVal += esc;
            break;
        }
      } else {
        strVal += this.advance();
      }
    }

    if (this.isAtEnd()) {
      throw new K1SyntaxError("Unterminated string literal in expression", "UNTERMINATED_STRING", startLoc);
    }

    this.advance(); // consume closing quote
    return {
      type: "STRING",
      value: strVal,
      literalValue: strVal,
      start: startLoc,
      end: this.currentLocation(),
    };
  }

  private readIdentifier(startLoc: SourceLocation): Token {
    let id = "";
    while (this.isAlphaNumeric(this.peek())) {
      id += this.advance();
    }

    if (id === "null") {
      return { type: "NULL", value: id, literalValue: null, start: startLoc, end: this.currentLocation() };
    }
    if (id === "true") {
      return { type: "BOOLEAN", value: id, literalValue: true, start: startLoc, end: this.currentLocation() };
    }
    if (id === "false") {
      return { type: "BOOLEAN", value: id, literalValue: false, start: startLoc, end: this.currentLocation() };
    }

    return {
      type: "IDENTIFIER",
      value: id,
      start: startLoc,
      end: this.currentLocation(),
    };
  }
}
