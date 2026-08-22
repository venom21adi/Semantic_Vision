"""Semantic Vision: parses a repository and exposes its structure,
dependencies, call relationships, and impact radius."""

from semantic_vision.repo_parser import parse_repository

__all__ = ["parse_repository"]
