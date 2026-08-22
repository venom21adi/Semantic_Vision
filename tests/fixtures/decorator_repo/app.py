def route(path):
    def wrapper(fn):
        return fn

    return wrapper


@route("/x")
def handler():
    return 1
