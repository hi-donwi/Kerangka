package engine

// A subset of the K1 evaluator (spec/semantics/expressions.md).
//
// Guards in a compiled model are AST nodes, not source strings. This evaluates the
// comparisons and boolean connectives a guard is written in. An operator outside that
// subset is unsupported: the caller must refuse it, not treat it as false and continue.
// A comparison this subset can decide, including one that is false, is supported.

// EvalOutcome is one evaluation. Supported is false when the node is outside the subset.
type EvalOutcome struct {
	Supported bool
	Value     any
}

func evalExpr(node any, record map[string]any) EvalOutcome {
	obj, ok := node.(map[string]any)
	if !ok {
		return EvalOutcome{}
	}
	if _, ok := obj["literal"]; ok {
		return EvalOutcome{Supported: true, Value: obj["literal"]}
	}
	if bind, ok := obj["$bind"]; ok {
		path, ok := bind.(string)
		if !ok {
			return EvalOutcome{}
		}
		return EvalOutcome{Supported: true, Value: resolveBind(path, record)}
	}
	op, ok := obj["$expr"].(string)
	if !ok {
		return EvalOutcome{}
	}
	args, _ := obj["args"].([]any)
	return evalCall(op, args, record)
}

func evalCall(op string, args []any, record map[string]any) EvalOutcome {
	switch op {
	case "!", "not":
		if len(args) != 1 {
			return EvalOutcome{}
		}
		inner := evalExpr(args[0], record)
		if !inner.Supported {
			return inner
		}
		return EvalOutcome{Supported: true, Value: !truthy(inner.Value)}
	case "&&", "and":
		if len(args) != 2 {
			return EvalOutcome{}
		}
		left := evalExpr(args[0], record)
		if !left.Supported {
			return left
		}
		if !truthy(left.Value) {
			return left
		}
		return evalExpr(args[1], record)
	case "||", "or":
		if len(args) != 2 {
			return EvalOutcome{}
		}
		left := evalExpr(args[0], record)
		if !left.Supported {
			return left
		}
		if truthy(left.Value) {
			return left
		}
		return evalExpr(args[1], record)
	case "==", "eq", "!=", "neq", "<", "<=", ">", ">=", "lt", "lte", "gt", "gte":
		if len(args) != 2 {
			return EvalOutcome{}
		}
		left := evalExpr(args[0], record)
		if !left.Supported {
			return left
		}
		right := evalExpr(args[1], record)
		if !right.Supported {
			return right
		}
		return EvalOutcome{Supported: true, Value: compare(op, left.Value, right.Value)}
	default:
		return EvalOutcome{}
	}
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
	outcome := evalExpr(when, record)
	if !outcome.Supported {
		return false, "GUARD_UNSUPPORTED"
	}
	if !truthy(outcome.Value) {
		return false, "GUARD_FAILED"
	}
	return true, ""
}
