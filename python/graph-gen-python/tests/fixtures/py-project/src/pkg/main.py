"""Entrypoint exercising every SPEC §3 import construct."""

import os                                   # stdlib -> external_boundary
import requests                             # configured external -> external_boundary
import pkg.helpers                          # first-party absolute -> resolved
from pkg.helpers import helper              # from-import module -> resolved
from . import relutil                       # bare relative submodule -> resolved
from .sub import leaf                       # relative into namespace pkg -> resolved
from ...escape import thing                 # ascends past repo root -> external_boundary
import totally_missing_pkg                  # not stdlib/external -> module_not_found
import importlib


def load(name):
    importlib.import_module("pkg.relutil")  # dynamic string literal -> unresolved
    return importlib.import_module(name)     # dynamic non-literal -> unresolved


def via_builtin():
    return __import__("os")                  # dynamic __import__ -> unresolved


def use():
    if True:
        import json                          # conditional stdlib -> external_boundary
    return helper(), relutil.relfn(), leaf.leaf_fn(), json
