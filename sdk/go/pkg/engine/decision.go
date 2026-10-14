package engine

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var (
	rangeRegex       = regexp.MustCompile(`^([[(])\s*([0-9.]+)\s*\.\.\s*([0-9.]+)\s*([\])])$`)
	decimalWireRegex = regexp.MustCompile(`^-?\d+(\.\d+)?$`)
)

// DecisionResult represents the outcome of evaluating a decision table.
type DecisionResult struct {
	Matched  bool   `json:"matched"`
	HitCount int    `json:"hitCount"`
	Outputs  any    `json:"outputs,omitempty"`
	Error    string `json:"error,omitempty"`
	Code     string `json:"code,omitempty"`
}

// DecisionColumn defines an input or output column of a decision table.
type DecisionColumn struct {
	Name string `json:"name"`
	Type string `json:"type,omitempty"`
}

// DecisionRule represents an explicit or canonical rule.
type DecisionRule struct {
	ID      string         `json:"id,omitempty"`
	Inputs  []any          `json:"inputs"`
	Outputs map[string]any `json:"outputs"`
}

// Decide evaluates a decision table by name or definition against the input record.
func (e *ReferenceEngine) Decide(tableOrName any, input map[string]any) DecisionResult {
	return e.EvaluateDecision(tableOrName, input)
}

// EvaluateDecision evaluates a decision table by name or definition against the input record.
func (e *ReferenceEngine) EvaluateDecision(tableOrName any, input map[string]any) DecisionResult {
	if input == nil {
		input = make(map[string]any)
	}

	var tableDef map[string]any
	var tableName string

	switch t := tableOrName.(type) {
	case string:
		tableName = t
		if e.doc.Decisions != nil {
			if raw, ok := e.doc.Decisions[t].(map[string]any); ok {
				tableDef = raw
			}
		}
	case map[string]any:
		tableDef = t
		if n, ok := t["name"].(string); ok {
			tableName = n
		}
	}

	if tableDef == nil {
		targetName := tableName
		if targetName == "" {
			targetName = fmt.Sprintf("%v", tableOrName)
		}
		return DecisionResult{
			Matched:  false,
			HitCount: 0,
			Error:    fmt.Sprintf("Decision table '%s' not found", targetName),
			Code:     "TABLE_NOT_FOUND",
		}
	}

	if tableName == "" {
		if n, ok := tableDef["name"].(string); ok {
			tableName = n
		}
	}

	inputs := parseDecisionColumns(tableDef["inputs"])
	outputs := parseDecisionColumns(tableDef["outputs"])

	hitPolicy := "first"
	if hp, ok := tableDef["hitPolicy"].(string); ok && hp != "" {
		hitPolicy = strings.ToLower(hp)
	}

	rules := parseDecisionRules(tableDef, inputs, outputs)

	var matchingOutputs []map[string]any

	for _, rule := range rules {
		ruleMatched := true

		for i, col := range inputs {
			var cell any
			if i < len(rule.Inputs) {
				cell = rule.Inputs[i]
			}
			val := input[col.Name]

			if !matchDecisionCell(cell, val) {
				ruleMatched = false
				break
			}
		}

		if ruleMatched {
			resolved := resolveDecisionOutputs(rule.Outputs, outputs, input)
			matchingOutputs = append(matchingOutputs, resolved)
			if hitPolicy == "first" {
				break
			}
		}
	}

	if len(matchingOutputs) == 0 {
		return DecisionResult{
			Matched:  false,
			HitCount: 0,
			Error:    fmt.Sprintf("Decision table '%s' matched no row", tableName),
			Code:     "DECISION_NO_MATCH",
		}
	}

	if hitPolicy == "unique" {
		if len(matchingOutputs) > 1 {
			return DecisionResult{
				Matched:  false,
				HitCount: len(matchingOutputs),
				Error:    fmt.Sprintf("Unique hit policy violated: %d rules matched in '%s'", len(matchingOutputs), tableName),
				Code:     "UNIQUE_VIOLATION",
			}
		}
		return DecisionResult{
			Matched:  true,
			HitCount: 1,
			Outputs:  matchingOutputs[0],
		}
	}

	if hitPolicy == "collect" {
		return DecisionResult{
			Matched:  true,
			HitCount: len(matchingOutputs),
			Outputs:  matchingOutputs,
		}
	}

	return DecisionResult{
		Matched:  true,
		HitCount: len(matchingOutputs),
		Outputs:  matchingOutputs[0],
	}
}

func parseDecisionColumns(raw any) []DecisionColumn {
	var cols []DecisionColumn
	items, ok := raw.([]any)
	if !ok {
		return cols
	}
	for _, item := range items {
		if m, ok := item.(map[string]any); ok {
			name, _ := m["name"].(string)
			colType, _ := m["type"].(string)
			cols = append(cols, DecisionColumn{Name: name, Type: colType})
		}
	}
	return cols
}

func parseDecisionRules(tableDef map[string]any, inputs, outputs []DecisionColumn) []DecisionRule {
	if rawRules, ok := tableDef["rules"].([]any); ok && len(rawRules) > 0 {
		var rules []DecisionRule
		for i, r := range rawRules {
			if rMap, ok := r.(map[string]any); ok {
				id, _ := rMap["id"].(string)
				if id == "" {
					id = fmt.Sprintf("rule-%d", i+1)
				}
				inSlice, _ := rMap["inputs"].([]any)
				outMap, _ := rMap["outputs"].(map[string]any)
				if outMap == nil {
					outMap = make(map[string]any)
				}
				rules = append(rules, DecisionRule{
					ID:      id,
					Inputs:  inSlice,
					Outputs: outMap,
				})
			}
		}
		return rules
	}

	// Canonical IR: rows form
	var rules []DecisionRule
	rows, ok := tableDef["rows"].([]any)
	if !ok {
		return rules
	}

	for i, r := range rows {
		rowMap, ok := r.(map[string]any)
		if !ok {
			continue
		}
		var ruleInputs []any
		for _, col := range inputs {
			if cell, exists := rowMap[col.Name]; exists && cell != nil {
				ruleInputs = append(ruleInputs, cell)
			} else {
				ruleInputs = append(ruleInputs, "-")
			}
		}

		ruleOutputs := make(map[string]any)
		for _, out := range outputs {
			if val, exists := rowMap[out.Name]; exists {
				ruleOutputs[out.Name] = coerceDecisionCell(val, out.Type)
			}
		}

		rules = append(rules, DecisionRule{
			ID:      fmt.Sprintf("row-%d", i+1),
			Inputs:  ruleInputs,
			Outputs: ruleOutputs,
		})
	}

	return rules
}

func matchDecisionCell(cell any, val any) bool {
	if cell == nil || cell == "-" {
		return true
	}

	switch c := cell.(type) {
	case string:
		trimmed := strings.TrimSpace(c)
		if trimmed == "-" || trimmed == "" {
			return true
		}

		valNum, isNum := toFloat(val)

		if strings.HasPrefix(trimmed, ">=") && isNum {
			target, err := strconv.ParseFloat(strings.TrimSpace(trimmed[2:]), 64)
			return err == nil && valNum >= target
		}
		if strings.HasPrefix(trimmed, ">") && isNum {
			target, err := strconv.ParseFloat(strings.TrimSpace(trimmed[1:]), 64)
			return err == nil && valNum > target
		}
		if strings.HasPrefix(trimmed, "<=") && isNum {
			target, err := strconv.ParseFloat(strings.TrimSpace(trimmed[2:]), 64)
			return err == nil && valNum <= target
		}
		if strings.HasPrefix(trimmed, "<") && isNum {
			target, err := strconv.ParseFloat(strings.TrimSpace(trimmed[1:]), 64)
			return err == nil && valNum < target
		}

		if (strings.HasPrefix(trimmed, "[") || strings.HasPrefix(trimmed, "(")) && isNum {
			if m := rangeRegex.FindStringSubmatch(trimmed); len(m) == 5 {
				leftBracket, minStr, maxStr, rightBracket := m[1], m[2], m[3], m[4]
				minVal, err1 := strconv.ParseFloat(minStr, 64)
				maxVal, err2 := strconv.ParseFloat(maxStr, 64)
				if err1 == nil && err2 == nil {
					minOk := (leftBracket == "[" && valNum >= minVal) || (leftBracket == "(" && valNum > minVal)
					maxOk := (rightBracket == "]" && valNum <= maxVal) || (rightBracket == ")" && valNum < maxVal)
					return minOk && maxOk
				}
			}
		}

		if strings.Contains(trimmed, ",") {
			parts := strings.Split(trimmed, ",")
			valStr := fmt.Sprintf("%v", val)
			for _, p := range parts {
				clean := strings.Trim(strings.TrimSpace(p), "'\"")
				if clean == valStr {
					return true
				}
			}
			return false
		}

		clean := strings.Trim(trimmed, "'\"")
		return fmt.Sprintf("%v", val) == clean

	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		cNum, _ := toFloat(c)
		vNum, ok := toFloat(val)
		return ok && cNum == vNum

	case bool:
		vBool, ok := val.(bool)
		return ok && c == vBool

	case map[string]any:
		res := evalNode(c, map[string]any{"cell": val, "value": val}, nil)
		return res.Supported && truthy(res.Value)

	default:
		return false
	}
}

func coerceDecisionCell(val any, colType string) any {
	if val == nil {
		return nil
	}
	str, ok := val.(string)
	if !ok {
		return val
	}
	t := strings.ToLower(colType)
	isNumeric := strings.HasPrefix(t, "int") || strings.HasPrefix(t, "number") || strings.HasPrefix(t, "decimal") || strings.HasPrefix(t, "float")
	isBoolean := strings.HasPrefix(t, "bool")

	trimmed := strings.TrimSpace(str)
	if isNumeric && decimalWireRegex.MatchString(trimmed) {
		if n, err := strconv.ParseFloat(trimmed, 64); err == nil {
			return n
		}
	}
	if isBoolean {
		if strings.EqualFold(trimmed, "true") {
			return true
		}
		if strings.EqualFold(trimmed, "false") {
			return false
		}
	}
	return val
}

func resolveDecisionOutputs(outputs map[string]any, columns []DecisionColumn, input map[string]any) map[string]any {
	resolved := make(map[string]any)

	for _, col := range columns {
		cellVal := outputs[col.Name]
		coerced := coerceDecisionCell(cellVal, col.Type)

		switch v := coerced.(type) {
		case string:
			trimmed := strings.TrimSpace(v)
			if (strings.HasPrefix(trimmed, "'") && strings.HasSuffix(trimmed, "'")) ||
				(strings.HasPrefix(trimmed, "\"") && strings.HasSuffix(trimmed, "\"")) {
				resolved[col.Name] = trimmed[1 : len(trimmed)-1]
			} else {
				resolved[col.Name] = trimmed
			}
		default:
			resolved[col.Name] = v
		}
	}

	for k, v := range outputs {
		if _, exists := resolved[k]; !exists {
			resolved[k] = v
		}
	}

	return resolved
}
