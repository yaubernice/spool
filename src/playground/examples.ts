export interface Example {
  name: string
  code: string
}

/** Four short programs. Each one is real language, not a special drawing mode. */
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
]
