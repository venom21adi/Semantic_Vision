def make():
    if True:
        class Local:
            def method(self):
                return 1

        return Local


class Outer:
    for _ in range(1):
        class Nested:
            pass


if True:
    class ModuleLevelConditional:
        pass
