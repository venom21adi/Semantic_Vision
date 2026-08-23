import os


def simple_branch(x):
    if x > 0:
        y = 1
    else:
        y = -1
    return y


def nested_branch_in_loop(items):
    total = 0
    for item in items:
        if item > 0:
            total += item
    return total


def while_with_break_continue(n):
    i = 0
    while i < n:
        i += 1
        if i == 5:
            continue
        if i == 8:
            break
        print(i)
    return i


def for_else_example(items):
    for item in items:
        if item == 0:
            break
    else:
        return -1
    return item


def multiple_returns(x):
    if x < 0:
        return "negative"
    if x == 0:
        return "zero"
    return "positive"


def elif_chain(x):
    if x < 0:
        return "negative"
    elif x == 0:
        return "zero"
    else:
        return "positive"


def no_explicit_return(items):
    for item in items:
        print(item)


def add_one(x):
    return x + 1


def calls_same_file_function(x):
    add_one(x)
    return x


def calls_external_function():
    os.getcwd()
    return None


class Alpha:
    def helper(self):
        return 1


class Beta:
    def helper(self):
        return 2


def calls_ambiguous_method(obj):
    obj.helper()
    return None
