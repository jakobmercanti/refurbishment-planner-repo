"""Minimise cloud planning documents without altering authoritative numeric inputs."""

from typing import Any

LOCAL_ONLY = {"quotes", "plannerBuild", "electricalLayout", "renderCamera", "snapshots"}
PRIVATE_TEXT = {
    "notes", "note", "description", "email", "telephone", "phone", "address", "postcode",
    "customerName", "customerEmail", "contact",
}


def cloud_project_document(document: dict[str, Any]) -> dict[str, Any]:
    def scrub(value: Any) -> Any:
        if isinstance(value, list):
            return [scrub(item) for item in value]
        if not isinstance(value, dict):
            return value
        return {
            key: [] if key == "annotations" else "" if key in PRIVATE_TEXT and isinstance(item, str) else scrub(item)
            for key, item in value.items() if key not in LOCAL_ONLY
        }

    return scrub(document)
