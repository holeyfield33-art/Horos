"""Module without __all__."""

CONST = 3


def visible():
    return CONST


def _hidden():
    return 0


async def also_visible():
    return 1


class Widget:
    pass


class _Private:
    pass
