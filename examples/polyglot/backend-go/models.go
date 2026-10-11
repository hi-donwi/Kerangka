package model

import (
	"time"
	"github.com/shopspring/decimal"
)

type TaskPriority string

const (
	TaskPriorityLow TaskPriority = "low"
	TaskPriorityMedium TaskPriority = "medium"
	TaskPriorityHigh TaskPriority = "high"
)

type Task struct {
	Id string `json:"id,omitempty"`
	Title string `json:"title"`
	Description *string `json:"description,omitempty"`
	Priority TaskPriority `json:"priority,omitempty"`
	Completed *bool `json:"completed,omitempty"`
	DueAt *time.Time `json:"dueAt,omitempty"`
	Tags []string `json:"tags,omitempty"`
}
