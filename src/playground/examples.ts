export interface Example {
  name: string
  code: string
}

/** Gallery programs. Each one is real language, not a special drawing mode. */
export const examples: Example[] = [
  {
    name: 'Spiral',
    code: `fn square(s) {
  repeat 4 {
    forward s
    turn 90
  }
}
repeat 36 {
  square(100)
  turn 10
}
`,
  },
  {
    name: 'Snowflake',
    code: `fn koch(n, len) {
  if n == 0 {
    forward len
  } else {
    koch(n - 1, len / 3)
    turn -60
    koch(n - 1, len / 3)
    turn 120
    koch(n - 1, len / 3)
    turn -60
    koch(n - 1, len / 3)
  }
}
color "#3d7ea6"
repeat 3 {
  koch(3, 240)
  turn 120
}
`,
  },
  {
    name: 'Tree',
    code: `fn tree(n, len) {
  if n == 0 {
    return
  }
  if n > 3 {
    color "#2f6b45"
    width 2.5
  } else {
    color "#a8643b"
    width 1.25
  }
  forward len
  turn 26
  tree(n - 1, len * 0.72)
  turn -52
  tree(n - 1, len * 0.72)
  turn 26
  back len
}
tree(7, 90)
`,
  },
  {
    name: 'Flower',
    code: `color "#c23b5a"
width 1.5
repeat 36 {
  forward 140
  turn 170
}
`,
  },
  {
    name: 'Koch',
    code: `fn koch(n, len) {
  if n == 0 {
    forward len
  } else {
    koch(n - 1, len / 3)
    turn -60
    koch(n - 1, len / 3)
    turn 120
    koch(n - 1, len / 3)
    turn -60
    koch(n - 1, len / 3)
  }
}
color "#9fd7ff"
width 1.4
repeat 3 {
  koch(4, 270)
  turn 120
}
`,
  },
  {
    name: 'Sierpinski',
    code: `fn sierpinski(n, len) {
  if n == 0 {
    repeat 3 {
      forward len
      turn 120
    }
  } else {
    sierpinski(n - 1, len / 2)
    forward len / 2
    sierpinski(n - 1, len / 2)
    back len / 2
    turn 60
    forward len / 2
    turn -60
    sierpinski(n - 1, len / 2)
    turn 60
    back len / 2
    turn -60
  }
}
color "#e0b15a"
sierpinski(5, 260)
`,
  },
  {
    name: 'Rainbow',
    code: `let hue = 0
repeat 90 {
  color hsl(hue, 78, 58)
  width 2
  forward hue * 0.45 + 8
  turn 47
  hue = hue + 4
}
`,
  },
  {
    name: 'Primes',
    code: `fn isPrime(n) {
  if n < 2 { return false }
  for i in 2..n {
    if n % i == 0 { return false }
  }
  return true
}
for n in 2..30 {
  if isPrime(n) { print n }
}
`,
  },
  {
    name: 'Sort',
    code: `let a = [5, 1, 4, 2, 8]
let n = len(a)
for i in 0..n {
  for j in 0..(n - 1) {
    if a[j] > a[j + 1] {
      let tmp = a[j]
      a[j] = a[j + 1]
      a[j + 1] = tmp
    }
  }
}
for i in 0..n {
  print a[i]
}
`,
  },
  {
    name: 'Fibonacci',
    code: `fn fib(n) {
  if n < 2 { return n }
  return fib(n - 1) + fib(n - 2)
}
for i in 0..12 {
  print fib(i)
}
`,
  },
  {
    name: 'FizzBuzz',
    code: `for i in 1..21 {
  if i % 15 == 0 {
    print "Fizz" + "Buzz"
  } else {
    if i % 3 == 0 {
      print "Fizz"
    } else {
      if i % 5 == 0 {
        print "Buzz"
      } else {
        print i
      }
    }
  }
}
`,
  },
]
