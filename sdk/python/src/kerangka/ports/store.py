"""
Kerangka Store Port Contract in Python.
"""

from typing import Protocol, Any, Dict, List, Optional
from dataclasses import dataclass


@dataclass
class QueryOptions:
    tenant_id: Optional[str] = None
    limit: Optional[int] = None
    offset: Optional[int] = None
    sort: Optional[Dict[str, str]] = None


@dataclass
class QueryResult:
    items: List[Dict[str, Any]]
    total: int
    limit: Optional[int] = None
    offset: Optional[int] = None


class StorePort(Protocol):
    """Abstract persistence interface for Kerangka entities."""

    async def get(
        self, entity_name: str, id: str, tenant_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]: ...

    async def find(
        self,
        entity_name: str,
        filter: Optional[Dict[str, Any]] = None,
        options: Optional[QueryOptions] = None,
    ) -> QueryResult: ...

    async def create(
        self, entity_name: str, record: Dict[str, Any], tenant_id: Optional[str] = None
    ) -> Dict[str, Any]: ...

    async def update(
        self,
        entity_name: str,
        id: str,
        patch: Dict[str, Any],
        tenant_id: Optional[str] = None,
    ) -> Dict[str, Any]: ...

    async def delete(
        self, entity_name: str, id: str, tenant_id: Optional[str] = None
    ) -> bool: ...
