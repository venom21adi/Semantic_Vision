def register(name):
    return lambda cls: cls


@register("thing")
class Widget:
    pass
