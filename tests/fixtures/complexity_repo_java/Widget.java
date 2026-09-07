public class Widget {
    int trivial() {
        return 1;
    }

    int nestedIfElseIf(int x) {
        if (x > 0) {
            return 1;
        } else if (x < 0) {
            return -1;
        } else {
            return 0;
        }
    }

    int loopWithBooleanCondition(int[] items) {
        int total = 0;
        for (int item : items) {
            if (item > 0 && item < 100) {
                total += item;
            }
        }
        return total;
    }

    int nestedLoop(int[][] matrix) {
        int total = 0;
        for (int[] row : matrix) {
            for (int cell : row) {
                total += cell;
            }
        }
        return total;
    }

    int plainForLoop(int n) {
        int total = 0;
        for (int i = 0; i < n; i++) {
            total += i;
        }
        return total;
    }

    String switchExample(int value) {
        switch (value) {
            case 1:
                return "one";
            case 2:
                return "two";
            default:
                return "other";
        }
    }

    int ternaryExpression(int x) {
        return x > 0 ? 1 : -1;
    }

    int tryCatchExample(int x) {
        try {
            return 100 / x;
        } catch (ArithmeticException e) {
            return 0;
        }
    }

    int whileAndDoWhile(int x) {
        while (x > 0) {
            x -= 1;
        }
        do {
            x += 1;
        } while (x < 10);
        return x;
    }

    int siblingLoops(int[] itemsA, int[] itemsB) {
        int total = 0;
        for (int a : itemsA) {
            total += a;
        }
        for (int b : itemsB) {
            total += b;
        }
        return total;
    }

    boolean tripleLogicalChain(boolean a, boolean b, boolean c) {
        return a && b && c;
    }

    int chainStep0() {
        return chainStep1();
    }

    int chainStep1() {
        return chainStep2();
    }

    int chainStep2() {
        return chainStep3();
    }

    int chainStep3() {
        return chainStep4();
    }

    int chainStep4() {
        return chainStep5();
    }

    int chainStep5() {
        return chainStep6();
    }

    int chainStep6() {
        return 42;
    }

    int cyclic0() {
        return cyclic1();
    }

    int cyclic1() {
        return cyclic2();
    }

    int cyclic2() {
        return cyclic3();
    }

    int cyclic3() {
        return cyclic4();
    }

    int cyclic4() {
        return cyclic5();
    }

    int cyclic5() {
        return cyclic6();
    }

    int cyclic6() {
        return cyclic7();
    }

    int cyclic7() {
        return cyclic0();
    }
}
