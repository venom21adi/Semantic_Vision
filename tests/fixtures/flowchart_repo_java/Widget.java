public class Widget {
    int simpleBranch(int x) {
        int y;
        if (x > 0) {
            y = 1;
        } else {
            y = -1;
        }
        return y;
    }

    int nestedBranchInLoop(int[] items) {
        int total = 0;
        for (int item : items) {
            if (item > 0) {
                total += item;
            }
        }
        return total;
    }

    int whileWithBreakContinue(int n) {
        int i = 0;
        while (i < n) {
            i++;
            if (i == 5) {
                continue;
            }
            if (i == 8) {
                break;
            }
            System.out.println(i);
        }
        return i;
    }

    int doWhileLoop(int n) {
        int i = 0;
        do {
            i++;
        } while (i < n);
        return i;
    }

    void plainForLoop(int n) {
        for (int i = 0; i < n; i++) {
            System.out.println(i);
        }
    }

    String switchWithFallthrough(int v) {
        switch (v) {
            case 1:
                doOne();
                break;
            case 2:
            case 3:
                doTwo();
            default:
                doDefault();
        }
        return "done";
    }

    void switchNoDefault(int v) {
        switch (v) {
            case 1:
                doOne();
        }
        after();
    }

    void labeledBreakContinue(int[][] matrix) {
        outer:
        for (int[] row : matrix) {
            for (int cell : row) {
                if (cell == 0) {
                    continue outer;
                }
                if (cell < 0) {
                    break outer;
                }
            }
        }
    }

    String multipleReturns(int x) {
        if (x < 0) {
            return "negative";
        }
        if (x == 0) {
            return "zero";
        }
        return "positive";
    }

    String elifChain(int x) {
        if (x < 0) {
            return "negative";
        } else if (x == 0) {
            return "zero";
        } else {
            return "positive";
        }
    }

    void noExplicitReturn(int[] items) {
        for (int item : items) {
            System.out.println(item);
        }
    }

    int addOne(int x) {
        return x + 1;
    }

    int callsSameFileFunction(int x) {
        addOne(x);
        return x;
    }

    void callsExternalFunction() {
        Math.max(1, 2);
    }

    void callsAmbiguousMethod(Alpha a) {
        a.helper();
    }

    void withTryCatchFinally() {
        try {
            risky();
        } catch (Exception e) {
            handle(e);
        } finally {
            cleanup();
        }
    }

    String switchWithBracedCase(int v) {
        switch (v) {
            case 1: {
                int x = 1;
                doOne();
                break;
            }
            case 2:
                doTwo();
                break;
            default:
                doDefault();
        }
        return "done";
    }

    int bareBlockWithConditionalReturn(int x) {
        {
            int y = x + 1;
            if (y > 0) {
                return y;
            }
        }
        return -1;
    }

    void switchInsideLoop(int[] items) {
        for (int item : items) {
            switch (item) {
                case 1:
                    doOne();
                    break;
                default:
                    doDefault();
            }
            after();
        }
    }

    void doOne() {}
    void doTwo() {}
    void doDefault() {}
    void after() {}
    void risky() {}
    void handle(Exception e) {}
    void cleanup() {}
}

class Alpha {
    int helper() {
        return 1;
    }
}

class Beta {
    int helper() {
        return 2;
    }
}
