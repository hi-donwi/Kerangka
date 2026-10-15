package engine

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"
)

// A subset of the K1 evaluator (spec/semantics/expressions.md, ADR-0008, ADR-0040, ADR-0044).
//
// Guards and read filters in a compiled model are AST nodes or lowered tuples.
// Permission conditions can be string expressions (PLAN.md §5.1), AST nodes, or tuples.
// This evaluates comparisons, boolean connectives, field accesses, and actor properties.
// An operator or syntax outside that subset is unsupported: the caller must refuse it
// (fail closed), not treat it as false or permissive and continue.

// EvalOutcome is one evaluation. Supported is false when the node or expression is outside the subset.
type EvalOutcome struct {
	Supported bool
	Value     any
}

func evalExpr(node any, record map[string]any) EvalOutcome {
	return evalNode(node, record, nil)
}

func evalNode(node any, record map[string]any, actor *ActorContext) EvalOutcome {
	if node == nil {
		return EvalOutcome{Supported: true, Value: nil}
	}

	switch v := node.(type) {
	case map[string]any:
		if _, ok := v["literal"]; ok {
			return EvalOutcome{Supported: true, Value: v["literal"]}
		}
		if bind, ok := v["$bind"]; ok {
			path, ok := bind.(string)
			if !ok {
				return EvalOutcome{}
			}
			return EvalOutcome{Supported: true, Value: resolvePath(path, record, actor)}
		}
		op, ok := v["$expr"].(string)
		if !ok {
			return EvalOutcome{}
		}
		args, _ := v["args"].([]any)
		return evalCall(op, args, record, actor)

	case []any:
		return evalTuple(v, record, actor)

	case string, bool, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		return EvalOutcome{Supported: true, Value: v}

	default:
		return EvalOutcome{}
	}
}

func evalCall(op string, args []any, record map[string]any, actor *ActorContext) EvalOutcome {
	switch op {
	case "!", "not":
		if len(args) != 1 {
			return EvalOutcome{}
		}
		inner := evalNode(args[0], record, actor)
		if !inner.Supported {
			return inner
		}
		return EvalOutcome{Supported: true, Value: !truthy(inner.Value)}
	case "&&", "and":
		if len(args) != 2 {
			return EvalOutcome{}
		}
		left := evalNode(args[0], record, actor)
		if !left.Supported {
			return left
		}
		if !truthy(left.Value) {
			return left
		}
		return evalNode(args[1], record, actor)
	case "||", "or":
		if len(args) != 2 {
			return EvalOutcome{}
		}
		left := evalNode(args[0], record, actor)
		if !left.Supported {
			return left
		}
		if truthy(left.Value) {
			return left
		}
		return evalNode(args[1], record, actor)
	case "==", "eq", "!=", "neq", "<", "<=", ">", ">=", "lt", "lte", "gt", "gte":
		if len(args) != 2 {
			return EvalOutcome{}
		}
		left := evalNode(args[0], record, actor)
		if !left.Supported {
			return left
		}
		right := evalNode(args[1], record, actor)
		if !right.Supported {
			return right
		}
		return EvalOutcome{Supported: true, Value: compare(op, left.Value, right.Value)}

	case "abs":
		if len(args) != 1 {
			return EvalOutcome{}
		}
		arg := evalNode(args[0], record, actor)
		if !arg.Supported {
			return arg
		}
		if arg.Value == nil {
			return EvalOutcome{Supported: true, Value: nil}
		}
		if n, ok := toFloat(arg.Value); ok {
			return EvalOutcome{Supported: true, Value: math.Abs(n)}
		}
		return EvalOutcome{}

	case "round":
		if len(args) < 1 || len(args) > 2 {
			return EvalOutcome{}
		}
		arg := evalNode(args[0], record, actor)
		if !arg.Supported {
			return arg
		}
		if arg.Value == nil {
			return EvalOutcome{Supported: true, Value: nil}
		}
		n, ok := toFloat(arg.Value)
		if !ok {
			return EvalOutcome{}
		}
		decimals := 0
		if len(args) == 2 {
			decArg := evalNode(args[1], record, actor)
			if !decArg.Supported {
				return decArg
			}
			if d, ok := toFloat(decArg.Value); ok {
				decimals = int(d)
			}
		}
		factor := math.Pow(10, float64(decimals))
		return EvalOutcome{Supported: true, Value: math.Round(n*factor) / factor}

	case "ceil":
		if len(args) != 1 {
			return EvalOutcome{}
		}
		arg := evalNode(args[0], record, actor)
		if !arg.Supported {
			return arg
		}
		if arg.Value == nil {
			return EvalOutcome{Supported: true, Value: nil}
		}
		if n, ok := toFloat(arg.Value); ok {
			return EvalOutcome{Supported: true, Value: math.Ceil(n)}
		}
		return EvalOutcome{}

	case "floor":
		if len(args) != 1 {
			return EvalOutcome{}
		}
		arg := evalNode(args[0], record, actor)
		if !arg.Supported {
			return arg
		}
		if arg.Value == nil {
			return EvalOutcome{Supported: true, Value: nil}
		}
		if n, ok := toFloat(arg.Value); ok {
			return EvalOutcome{Supported: true, Value: math.Floor(n)}
		}
		return EvalOutcome{}

	case "min":
		if len(args) != 2 {
			return EvalOutcome{}
		}
		a := evalNode(args[0], record, actor)
		if !a.Supported {
			return a
		}
		b := evalNode(args[1], record, actor)
		if !b.Supported {
			return b
		}
		if a.Value == nil || b.Value == nil {
			return EvalOutcome{Supported: true, Value: nil}
		}
		aNum, okA := toFloat(a.Value)
		bNum, okB := toFloat(b.Value)
		if okA && okB {
			return EvalOutcome{Supported: true, Value: math.Min(aNum, bNum)}
		}
		return EvalOutcome{}

	case "max":
		if len(args) != 2 {
			return EvalOutcome{}
		}
		a := evalNode(args[0], record, actor)
		if !a.Supported {
			return a
		}
		b := evalNode(args[1], record, actor)
		if !b.Supported {
			return b
		}
		if a.Value == nil || b.Value == nil {
			return EvalOutcome{Supported: true, Value: nil}
		}
		aNum, okA := toFloat(a.Value)
		bNum, okB := toFloat(b.Value)
		if okA && okB {
			return EvalOutcome{Supported: true, Value: math.Max(aNum, bNum)}
		}
		return EvalOutcome{}

	case "lower":
		if len(args) != 1 {
			return EvalOutcome{}
		}
		arg := evalNode(args[0], record, actor)
		if !arg.Supported {
			return arg
		}
		if arg.Value == nil {
			return EvalOutcome{Supported: true, Value: nil}
		}
		return EvalOutcome{Supported: true, Value: strings.ToLower(fmt.Sprintf("%v", arg.Value))}

	case "upper":
		if len(args) != 1 {
			return EvalOutcome{}
		}
		arg := evalNode(args[0], record, actor)
		if !arg.Supported {
			return arg
		}
		if arg.Value == nil {
			return EvalOutcome{Supported: true, Value: nil}
		}
		return EvalOutcome{Supported: true, Value: strings.ToUpper(fmt.Sprintf("%v", arg.Value))}

	case "trim":
		if len(args) != 1 {
			return EvalOutcome{}
		}
		arg := evalNode(args[0], record, actor)
		if !arg.Supported {
			return arg
		}
		if arg.Value == nil {
			return EvalOutcome{Supported: true, Value: nil}
		}
		return EvalOutcome{Supported: true, Value: strings.TrimSpace(fmt.Sprintf("%v", arg.Value))}

	case "len":
		if len(args) != 1 {
			return EvalOutcome{}
		}
		arg := evalNode(args[0], record, actor)
		if !arg.Supported {
			return arg
		}
		if arg.Value == nil {
			return EvalOutcome{Supported: true, Value: 0}
		}
		switch v := arg.Value.(type) {
		case string:
			return EvalOutcome{Supported: true, Value: len(v)}
		case []any:
			return EvalOutcome{Supported: true, Value: len(v)}
		default:
			return EvalOutcome{Supported: true, Value: 0}
		}

	case "contains":
		if len(args) != 2 {
			return EvalOutcome{}
		}
		haystack := evalNode(args[0], record, actor)
		if !haystack.Supported {
			return haystack
		}
		needle := evalNode(args[1], record, actor)
		if !needle.Supported {
			return needle
		}
		if haystack.Value == nil || needle.Value == nil {
			return EvalOutcome{Supported: true, Value: false}
		}
		switch h := haystack.Value.(type) {
		case string:
			return EvalOutcome{Supported: true, Value: strings.Contains(h, fmt.Sprintf("%v", needle.Value))}
		case []any:
			for _, item := range h {
				if item == needle.Value {
					return EvalOutcome{Supported: true, Value: true}
				}
			}
			return EvalOutcome{Supported: true, Value: false}
		default:
			return EvalOutcome{Supported: true, Value: false}
		}

	case "startsWith":
		if len(args) != 2 {
			return EvalOutcome{}
		}
		str := evalNode(args[0], record, actor)
		if !str.Supported {
			return str
		}
		prefix := evalNode(args[1], record, actor)
		if !prefix.Supported {
			return prefix
		}
		if str.Value == nil || prefix.Value == nil {
			return EvalOutcome{Supported: true, Value: false}
		}
		return EvalOutcome{Supported: true, Value: strings.HasPrefix(fmt.Sprintf("%v", str.Value), fmt.Sprintf("%v", prefix.Value))}

	case "concat":
		var b strings.Builder
		for _, arg := range args {
			res := evalNode(arg, record, actor)
			if !res.Supported {
				return res
			}
			if res.Value == nil {
				return EvalOutcome{Supported: true, Value: nil}
			}
			b.WriteString(fmt.Sprintf("%v", res.Value))
		}
		return EvalOutcome{Supported: true, Value: b.String()}

	case "coalesce":
		for _, arg := range args {
			res := evalNode(arg, record, actor)
			if !res.Supported {
				return res
			}
			if res.Value != nil {
				return EvalOutcome{Supported: true, Value: res.Value}
			}
		}
		return EvalOutcome{Supported: true, Value: nil}

	case "in":
		if len(args) != 2 {
			return EvalOutcome{}
		}
		item := evalNode(args[0], record, actor)
		if !item.Supported {
			return item
		}
		list := evalNode(args[1], record, actor)
		if !list.Supported {
			return list
		}
		if item.Value == nil || list.Value == nil {
			return EvalOutcome{Supported: true, Value: false}
		}
		if slice, ok := list.Value.([]any); ok {
			for _, el := range slice {
				if el == item.Value {
					return EvalOutcome{Supported: true, Value: true}
				}
			}
		}
		return EvalOutcome{Supported: true, Value: false}

	case "isSet":
		if len(args) != 1 {
			return EvalOutcome{}
		}
		arg := evalNode(args[0], record, actor)
		if !arg.Supported {
			return arg
		}
		return EvalOutcome{Supported: true, Value: arg.Value != nil}

	case "is_null":
		if len(args) != 1 {
			return EvalOutcome{}
		}
		arg := evalNode(args[0], record, actor)
		if !arg.Supported {
			return arg
		}
		return EvalOutcome{Supported: true, Value: arg.Value == nil}

	default:
		return EvalOutcome{}
	}
}

func evalTuple(tuple []any, record map[string]any, actor *ActorContext) EvalOutcome {
	if len(tuple) == 0 {
		return EvalOutcome{}
	}
	op, ok := tuple[0].(string)
	if !ok {
		return EvalOutcome{}
	}

	switch op {
	case "literal":
		if len(tuple) != 2 {
			return EvalOutcome{}
		}
		return EvalOutcome{Supported: true, Value: tuple[1]}

	case "get":
		if len(tuple) < 2 {
			return EvalOutcome{}
		}
		path := joinTuplePath(tuple[1:])
		return EvalOutcome{Supported: true, Value: resolveBind(path, record)}

	case "actor":
		if len(tuple) < 2 {
			return EvalOutcome{}
		}
		path := joinTuplePath(tuple[1:])
		if actor == nil {
			return EvalOutcome{Supported: true, Value: nil}
		}
		return EvalOutcome{Supported: true, Value: actor.Resolve(path)}

	case "is_null":
		if len(tuple) != 2 {
			return EvalOutcome{}
		}
		inner := evalNode(tuple[1], record, actor)
		if !inner.Supported {
			return inner
		}
		return EvalOutcome{Supported: true, Value: inner.Value == nil}

	case "!", "not":
		if len(tuple) != 2 {
			return EvalOutcome{}
		}
		inner := evalNode(tuple[1], record, actor)
		if !inner.Supported {
			return inner
		}
		return EvalOutcome{Supported: true, Value: !truthy(inner.Value)}

	case "&&", "and":
		if len(tuple) < 2 {
			return EvalOutcome{}
		}
		for _, arg := range tuple[1:] {
			res := evalNode(arg, record, actor)
			if !res.Supported {
				return res
			}
			if !truthy(res.Value) {
				return EvalOutcome{Supported: true, Value: false}
			}
		}
		return EvalOutcome{Supported: true, Value: true}

	case "||", "or":
		if len(tuple) < 2 {
			return EvalOutcome{}
		}
		anyTrue := false
		for _, arg := range tuple[1:] {
			res := evalNode(arg, record, actor)
			if !res.Supported {
				return res
			}
			if truthy(res.Value) {
				anyTrue = true
				break
			}
		}
		return EvalOutcome{Supported: true, Value: anyTrue}

	case "==", "eq", "!=", "neq", "<", "<=", ">", ">=", "lt", "lte", "gt", "gte":
		if len(tuple) != 3 {
			return EvalOutcome{}
		}
		left := evalNode(tuple[1], record, actor)
		if !left.Supported {
			return left
		}
		right := evalNode(tuple[2], record, actor)
		if !right.Supported {
			return right
		}
		return EvalOutcome{Supported: true, Value: compare(op, left.Value, right.Value)}

	default:
		return evalCall(op, tuple[1:], record, actor)
	}
}

func joinTuplePath(args []any) string {
	parts := make([]string, 0, len(args))
	for _, a := range args {
		if s, ok := a.(string); ok {
			parts = append(parts, s)
		}
	}
	return strings.Join(parts, ".")
}

func resolvePath(path string, record map[string]any, actor *ActorContext) any {
	if strings.HasPrefix(path, "actor.") {
		if actor == nil {
			return nil
		}
		return actor.Resolve(strings.TrimPrefix(path, "actor."))
	}
	if strings.HasPrefix(path, "record.") {
		return resolveBind(strings.TrimPrefix(path, "record."), record)
	}
	return resolveBind(path, record)
}

func compare(op string, left, right any) bool {
	switch op {
	case "==", "eq":
		if left == nil && right == nil {
			return true
		}
		if left == nil || right == nil {
			return false
		}
		lf, lok := toFloat(left)
		rf, rok := toFloat(right)
		if lok && rok {
			return lf == rf
		}
		return left == right
	case "!=", "neq":
		if left == nil && right == nil {
			return false
		}
		if left == nil || right == nil {
			return true
		}
		lf, lok := toFloat(left)
		rf, rok := toFloat(right)
		if lok && rok {
			return lf != rf
		}
		return left != right
	}
	if left == nil || right == nil {
		return false
	}
	lf, lok := toFloat(left)
	rf, rok := toFloat(right)
	if lok && rok {
		switch op {
		case "<", "lt":
			return lf < rf
		case "<=", "lte":
			return lf <= rf
		case ">", "gt":
			return lf > rf
		case ">=", "gte":
			return lf >= rf
		}
		return false
	}
	ls, lok := left.(string)
	rs, rok := right.(string)
	if !lok || !rok {
		return false
	}
	switch op {
	case "<", "lt":
		return ls < rs
	case "<=", "lte":
		return ls <= rs
	case ">", "gt":
		return ls > rs
	case ">=", "gte":
		return ls >= rs
	default:
		return false
	}
}

func resolveBind(path string, record map[string]any) any {
	if record == nil {
		return nil
	}
	if value, ok := record[path]; ok {
		return value
	}
	var current any = record
	start := 0
	for i := 0; i <= len(path); i++ {
		if i != len(path) && path[i] != '.' {
			continue
		}
		seg := path[start:i]
		start = i + 1
		obj, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		next, ok := obj[seg]
		if !ok {
			return nil
		}
		current = next
	}
	return current
}

func truthy(value any) bool {
	if value == nil || value == false {
		return false
	}
	if s, ok := value.(string); ok && s == "" {
		return false
	}
	if n, ok := toFloat(value); ok && n == 0 {
		return false
	}
	return true
}

func guardAllows(when any, record map[string]any) (bool, string) {
	if when == nil {
		return true, ""
	}
	outcome := evalNode(when, record, nil)
	if !outcome.Supported {
		return false, "GUARD_UNSUPPORTED"
	}
	if !truthy(outcome.Value) {
		return false, "GUARD_FAILED"
	}
	return true, ""
}

// evalCondition evaluates a condition against a record and actor.
// The condition may be an AST node (map[string]any), a tuple ([]any),
// or a simple expression string (e.g. "status == 'draft'").
func evalCondition(cond any, record map[string]any, actor *ActorContext) EvalOutcome {
	if cond == nil {
		return EvalOutcome{Supported: true, Value: true}
	}
	if s, ok := cond.(string); ok {
		ast, err := parseCondition(s)
		if err != nil {
			return EvalOutcome{Supported: false}
		}
		return evalNode(ast, record, actor)
	}
	return evalNode(cond, record, actor)
}

// Token types for simple condition parser.
type tokenType int

const (
	tokEOF tokenType = iota
	tokIdent
	tokString
	tokNumber
	tokBool
	tokNull
	tokOp
	tokLParen
	tokRParen
)

type token struct {
	typ tokenType
	val any
	raw string
}

func tokenizeCondition(src string) ([]token, error) {
	var tokens []token
	runes := []rune(src)
	i := 0
	n := len(runes)

	for i < n {
		ch := runes[i]
		if unicode.IsSpace(ch) {
			i++
			continue
		}

		if ch == '(' {
			tokens = append(tokens, token{typ: tokLParen, raw: "("})
			i++
			continue
		}
		if ch == ')' {
			tokens = append(tokens, token{typ: tokRParen, raw: ")"})
			i++
			continue
		}

		// Strings
		if ch == '\'' || ch == '"' {
			quote := ch
			i++
			start := i
			for i < n && runes[i] != quote {
				if runes[i] == '\\' && i+1 < n {
					i += 2
				} else {
					i++
				}
			}
			if i >= n {
				return nil, errors.New("unclosed string literal")
			}
			strVal := string(runes[start:i])
			i++ // skip closing quote
			tokens = append(tokens, token{typ: tokString, val: strVal, raw: strVal})
			continue
		}

		// Two-character operators
		if i+1 < n {
			two := string(runes[i : i+2])
			if two == "==" || two == "!=" || two == "<=" || two == ">=" || two == "&&" || two == "||" {
				tokens = append(tokens, token{typ: tokOp, raw: two})
				i += 2
				continue
			}
		}

		// Single-character operators
		if ch == '<' || ch == '>' || ch == '!' {
			tokens = append(tokens, token{typ: tokOp, raw: string(ch)})
			i++
			continue
		}

		// Numbers (digits or leading minus for negative number)
		if unicode.IsDigit(ch) || (ch == '-' && i+1 < n && unicode.IsDigit(runes[i+1])) {
			start := i
			if ch == '-' {
				i++
			}
			hasDot := false
			for i < n && (unicode.IsDigit(runes[i]) || runes[i] == '.') {
				if runes[i] == '.' {
					if hasDot {
						return nil, errors.New("multiple decimal points")
					}
					hasDot = true
				}
				i++
			}
			numStr := string(runes[start:i])
			numVal, err := strconv.ParseFloat(numStr, 64)
			if err != nil {
				return nil, err
			}
			tokens = append(tokens, token{typ: tokNumber, val: numVal, raw: numStr})
			continue
		}

		// Identifiers and keywords
		if unicode.IsLetter(ch) || ch == '_' {
			start := i
			for i < n && (unicode.IsLetter(runes[i]) || unicode.IsDigit(runes[i]) || runes[i] == '_' || runes[i] == '.') {
				i++
			}
			ident := string(runes[start:i])
			switch ident {
			case "true":
				tokens = append(tokens, token{typ: tokBool, val: true, raw: ident})
			case "false":
				tokens = append(tokens, token{typ: tokBool, val: false, raw: ident})
			case "null", "nil":
				tokens = append(tokens, token{typ: tokNull, val: nil, raw: ident})
			case "and":
				tokens = append(tokens, token{typ: tokOp, raw: "&&"})
			case "or":
				tokens = append(tokens, token{typ: tokOp, raw: "||"})
			case "not":
				tokens = append(tokens, token{typ: tokOp, raw: "!"})
			default:
				tokens = append(tokens, token{typ: tokIdent, val: ident, raw: ident})
			}
			continue
		}

		return nil, errors.New("unexpected character in condition: " + string(ch))
	}

	tokens = append(tokens, token{typ: tokEOF, raw: ""})
	return tokens, nil
}

type condParser struct {
	tokens []token
	pos    int
}

func (p *condParser) peek() token {
	if p.pos < len(p.tokens) {
		return p.tokens[p.pos]
	}
	return token{typ: tokEOF}
}

func (p *condParser) next() token {
	t := p.peek()
	if p.pos < len(p.tokens) {
		p.pos++
	}
	return t
}

func parseCondition(src string) (any, error) {
	trimmed := strings.TrimSpace(src)
	if trimmed == "" {
		return nil, errors.New("empty condition")
	}
	tokens, err := tokenizeCondition(trimmed)
	if err != nil {
		return nil, err
	}
	p := &condParser{tokens: tokens}
	expr, err := p.parseOr()
	if err != nil {
		return nil, err
	}
	if p.peek().typ != tokEOF {
		return nil, errors.New("unexpected trailing tokens in condition")
	}
	return expr, nil
}

func (p *condParser) parseOr() (any, error) {
	left, err := p.parseAnd()
	if err != nil {
		return nil, err
	}
	for p.peek().typ == tokOp && p.peek().raw == "||" {
		p.next()
		right, err := p.parseAnd()
		if err != nil {
			return nil, err
		}
		left = []any{"or", left, right}
	}
	return left, nil
}

func (p *condParser) parseAnd() (any, error) {
	left, err := p.parseComparison()
	if err != nil {
		return nil, err
	}
	for p.peek().typ == tokOp && p.peek().raw == "&&" {
		p.next()
		right, err := p.parseComparison()
		if err != nil {
			return nil, err
		}
		left = []any{"and", left, right}
	}
	return left, nil
}

func (p *condParser) parseComparison() (any, error) {
	left, err := p.parsePrimary()
	if err != nil {
		return nil, err
	}
	tok := p.peek()
	if tok.typ == tokOp && (tok.raw == "==" || tok.raw == "!=" || tok.raw == "<" || tok.raw == "<=" || tok.raw == ">" || tok.raw == ">=") {
		p.next()
		right, err := p.parsePrimary()
		if err != nil {
			return nil, err
		}
		return []any{tok.raw, left, right}, nil
	}
	return left, nil
}

func (p *condParser) parsePrimary() (any, error) {
	tok := p.peek()
	if tok.typ == tokOp && tok.raw == "!" {
		p.next()
		inner, err := p.parsePrimary()
		if err != nil {
			return nil, err
		}
		return []any{"!", inner}, nil
	}
	if tok.typ == tokLParen {
		p.next()
		inner, err := p.parseOr()
		if err != nil {
			return nil, err
		}
		if p.peek().typ != tokRParen {
			return nil, errors.New("missing closing parenthesis")
		}
		p.next()
		return inner, nil
	}
	if tok.typ == tokString || tok.typ == tokNumber || tok.typ == tokBool || tok.typ == tokNull {
		p.next()
		return tok.val, nil
	}
	if tok.typ == tokIdent {
		p.next()
		ident := tok.raw
		if strings.HasPrefix(ident, "actor.") {
			return []any{"actor", strings.TrimPrefix(ident, "actor.")}, nil
		}
		if strings.HasPrefix(ident, "record.") {
			return []any{"get", strings.TrimPrefix(ident, "record.")}, nil
		}
		return []any{"get", ident}, nil
	}
	return nil, errors.New("unexpected token in expression: " + tok.raw)
}
