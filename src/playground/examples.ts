export interface Example {
  name: string
  code: string
}

/** Gallery programs. Each one is real language, not a special drawing mode. */
export const examples: Example[] = [
  {
    name: 'Undo',
    code: `# Undo. Arrows dodge. Space rewinds two seconds.
use draw
use input
use audio
let W = 360px
let H = 240px
entity Player { r, pos }
entity Block { w, h, vel, pos }
entity Gem { r, vel, pos }
entity Spark { r, vel, life, pos }
let player = spawn Player at (180px, 200px) { r: 8px }
let mode = "title"
let score = 0
let energy = 20
let shake = 0px
let wave = 0
on tick(dt) {
  draw.background("#102033")
  # Refill is ordinary code. rewind restores the lower past value, which spends the bar.
  energy = clamp(energy + 10 * dt / 1s, 0, 100)
  if shake > 0px { draw.camera((random() - 0.5) * shake, (random() - 0.5) * shake) shake -= 500px/s * dt }
  else { draw.camera(0px, 0px) }
  if mode == "play" {
    if input.key("left") { player.x -= 170px/s * dt } if input.key("right") { player.x += 170px/s * dt }
    player.x = clamp(player.x, 12px, W - 12px) player.pos = vec(player.x, player.y)
    wave += 1
    if wave > 20 {
      wave = 0
      spawn Block at (16px + random() * 320px, -12px) { w: 16px, h: 16px, vel: vec(0px/s, 80px/s) }
      if random() < 0.4 { spawn Gem at (16px + random() * 320px, -8px) { r: 5px, vel: vec(0px/s, 90px/s) } }
    }
  }
  each b in Block {
    if mode == "play" { b.pos += b.vel * dt }
    if b.pos.y > H + 16px { despawn b } else { draw.rect(b.pos.x - 8px, b.pos.y - 8px, b.w, b.h, "#e07a5f") }
  }
  each g in Gem {
    if mode == "play" { g.pos += g.vel * dt }
    if g.pos.y > H + 8px { despawn g } else { draw.circle(g.pos.x, g.pos.y, g.r, "#f2c14e") }
  }
  each s in Spark {
    s.pos += s.vel * dt s.life -= dt / 1s
    if s.life <= 0 { despawn s } else { draw.circle(s.pos.x, s.pos.y, s.r, "#f4efe6") }
  }
  draw.circle(player.x, player.y, player.r, "#9fd7ff")
  draw.rect(8px, 8px, energy / 100 * 72px, 6px, "#8ecae6") draw.text(88px, 16px, "{score}", "#f4efe6")
  if mode == "title" { draw.text(118px, 108px, "UNDO", "#f4efe6") draw.text(78px, 136px, "space to start", "#8ecae6") }
  if mode == "over" { draw.text(108px, 120px, "game over", "#f4efe6") draw.text(78px, 146px, "space to restart", "#8ecae6") }
}
on key "space" {
  if mode == "title" { mode = "play" }
  else {
    if mode == "over" {
      mode = "title" score = 0 energy = 20 player.x = 180px player.pos = vec(player.x, player.y)
      each b in Block { despawn b }
      each g in Gem { despawn g }
    } else { if energy > 40 { rewind 2s } }
  }
}
when p in Player touches b in Block {
  if mode == "play" { mode = "over" shake = 14px audio.play("boom") spawn Spark at (p.pos.x, p.pos.y) { r: 3px, vel: vec(-30px/s, -70px/s), life: 0.45 } spawn Spark at (p.pos.x, p.pos.y) { r: 2px, vel: vec(40px/s, -40px/s), life: 0.35 } }
}
when p in Player touches g in Gem {
  if mode == "play" { score += 1 energy = clamp(energy + 12, 0, 100) audio.play("score") spawn Spark at (g.pos.x, g.pos.y) { r: 2px, vel: vec(0px/s, -50px/s), life: 0.3 } despawn g }
}
`,
  },
  {
    name: 'Pong',
    code: `# Pong. W and S move your paddle.
use draw
use input
use audio
let W = 360px
let H = 240px
entity Paddle { w, h }
entity Ball { r, vel }
let you = 0
let cpu = 0
spawn Paddle at (16px, 120px) { w: 10px, h: 48px }
spawn Paddle at (344px, 120px) { w: 10px, h: 48px }
spawn Ball at (180px, 120px) { r: 5px, vel: vec(160px/s, 70px/s) }
on tick(dt) {
  draw.background("#102033")
  each p in Paddle {
    # Left paddle is yours. The right one chases the ball.
    if p.x < 80px { if input.key("w") { p.y -= 200px/s * dt } if input.key("s") { p.y += 200px/s * dt } }
    else { each ball in Ball { if ball.y > p.y { p.y += 140px/s * dt } if ball.y < p.y { p.y -= 140px/s * dt } } }
    p.y = clamp(p.y, 24px, H - 24px)
    draw.rect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, "#f4efe6")
  }
  each ball in Ball {
    ball.x += ball.vel.x * dt
    ball.y += ball.vel.y * dt
    if ball.y < ball.r or ball.y > H - ball.r { ball.y = clamp(ball.y, ball.r, H - ball.r) ball.vel.y = bounce(ball.vel.y) }
    if ball.x < 0px or ball.x > W { if ball.x > W { you += 1 audio.play("score") } else { cpu += 1 } ball.x = 180px ball.vel.x = bounce(ball.vel.x) }
    draw.circle(ball.x, ball.y, ball.r, "#f2c14e")
  }
  draw.text(130px, 24px, "{you}", "#f4efe6") draw.text(210px, 24px, "{cpu}", "#8ecae6")
}
when ball in Ball touches pad in Paddle {
  if ball.vel.x > 0px/s and pad.x > ball.x { ball.vel.x = bounce(ball.vel.x) ball.x = pad.x - pad.w / 2 - ball.r - 1px audio.play("hit") }
  if ball.vel.x < 0px/s and pad.x < ball.x { ball.vel.x = bounce(ball.vel.x) ball.x = pad.x + pad.w / 2 + ball.r + 1px audio.play("hit") }
}
`,
  },
  {
    name: 'Snake',
    code: `# Snake. Arrow keys steer.
use draw
use input
use audio
entity Seg { i, w, h }
entity Food { r }
let dir = 1
let next = 1
let step = 0
let size = 3
let alive = true
let grow = false
spawn Seg at (48px, 80px) { i: 2, w: 14px, h: 14px }
spawn Seg at (64px, 80px) { i: 1, w: 14px, h: 14px }
spawn Seg at (80px, 80px) { i: 0, w: 14px, h: 14px }
spawn Food at (200px, 80px) { r: 6px }
on tick(dt) {
  draw.background("#102033")
  if alive {
    # 1 right, 2 left, 3 up, 4 down. Don't reverse into yourself.
    if input.key("right") { if dir != 2 { next = 1 } } if input.key("left") { if dir != 1 { next = 2 } }
    if input.key("up") { if dir != 4 { next = 3 } } if input.key("down") { if dir != 3 { next = 4 } }
    step += 1
    if step > 8 {
      step = 0 dir = next
      let hx = 0px let hy = 0px
      each s in Seg where s.i == 0 { hx = s.x hy = s.y }
      if dir == 1 { hx += 16px } if dir == 2 { hx -= 16px } if dir == 3 { hy -= 16px } if dir == 4 { hy += 16px }
      if hx < 8px or hx > 352px or hy < 8px or hy > 232px { alive = false }
      if alive {
        each s in Seg { s.i += 1 }
        if grow {
          spawn Seg at (hx, hy) { i: 0, w: 14px, h: 14px }
          spawn Food at (24px + random() * 300px, 24px + random() * 180px) { r: 6px }
          size += 1 grow = false audio.play("score")
        } else { each s in Seg where s.i == size { s.x = hx s.y = hy s.i = 0 } }
      }
    }
  }
  each s in Seg { draw.rect(s.x - 7px, s.y - 7px, s.w, s.h, "#9fd7ff") }
  each f in Food { draw.circle(f.x, f.y, f.r, "#f2c14e") }
  draw.text(8px, 22px, "{size}", "#f4efe6") if not alive { draw.text(120px, 120px, "crashed", "#f4efe6") }
}
when head in Seg touches food in Food { if head.i == 0 { grow = true despawn food } }
when a in Seg touches b in Seg { if a.i == 0 { if b.i > 1 { alive = false } } if b.i == 0 { if a.i > 1 { alive = false } } }
`,
  },
  {
    name: 'Breakout',
    code: `# Breakout. Left, right, or the mouse.
use draw
use input
use audio
let W = 360px
let H = 240px
entity Paddle { w, h }
entity Ball { r, vel }
entity Brick { w, h }
let score = 0
spawn Paddle at (180px, 220px) { w: 56px, h: 8px }
spawn Ball at (180px, 160px) { r: 4px, vel: vec(120px/s, -160px/s) }
for row in 0..3 {
  for col in 0..6 {
    spawn Brick at (42px + col * 52px, 32px + row * 16px) { w: 48px, h: 12px }
  }
}
on tick(dt) {
  draw.background("#102033")
  each p in Paddle {
    if input.key("left") { p.x -= 240px/s * dt }
    if input.key("right") { p.x += 240px/s * dt }
    if input.mouse().x > 0px { p.x = input.mouse().x }
    p.x = clamp(p.x, 28px, W - 28px)
    draw.rect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, "#f4efe6")
  }
  each ball in Ball {
    ball.x += ball.vel.x * dt
    ball.y += ball.vel.y * dt
    if ball.x < ball.r or ball.x > W - ball.r { ball.x = clamp(ball.x, ball.r, W - ball.r) ball.vel.x = bounce(ball.vel.x) }
    if ball.y < ball.r { ball.y = ball.r ball.vel.y = bounce(ball.vel.y) }
    if ball.y > H { ball.x = 180px ball.y = 160px ball.vel.y = -160px/s }
    draw.circle(ball.x, ball.y, ball.r, "#f2c14e")
  }
  each brick in Brick { draw.rect(brick.x - brick.w / 2, brick.y - brick.h / 2, brick.w, brick.h, "#e07a5f") }
  draw.text(8px, 18px, "{score}", "#f4efe6")
}
when ball in Ball touches brick in Brick { ball.vel.y = bounce(ball.vel.y) despawn brick score += 1 audio.play("hit") }
when ball in Ball touches p in Paddle {
  if ball.vel.y > 0px/s { ball.vel.y = bounce(ball.vel.y) ball.y = p.y - p.h / 2 - ball.r - 1px audio.play("hit") }
}
`,
  },
  {
    name: 'Asteroids',
    code: `# Asteroids. Left and right turn. Up thrusts. Space shoots.
use draw
use input
use audio
let W = 360px
let H = 240px
entity Ship { r, a, vx, vy }
entity Rock { r, vx, vy }
entity Shot { r, vx, vy }
let score = 0
let cool = 0
let alive = true
let ship = spawn Ship at (180px, 120px) { r: 8px, a: -1.57, vx: 0px, vy: 0px }
spawn Rock at (60px, 40px) { r: 18px, vx: 1.1px, vy: 0.4px }
spawn Rock at (300px, 50px) { r: 14px, vx: -0.8px, vy: 0.7px }
spawn Rock at (280px, 190px) { r: 20px, vx: -0.3px, vy: -0.9px }
on tick(dt) {
  draw.background("#102033")
  if alive {
    if input.key("left") { ship.a = ship.a - 0.06 }
    if input.key("right") { ship.a = ship.a + 0.06 }
    if input.key("up") {
      ship.vx = ship.vx + cos(ship.a) * 0.03px
      ship.vy = ship.vy + sin(ship.a) * 0.03px
    }
    ship.vx = ship.vx * 0.99
    ship.vy = ship.vy * 0.99
    ship.x = ship.x + ship.vx
    ship.y = ship.y + ship.vy
    if ship.x < 0px { ship.x = ship.x + W }
    if ship.x > W { ship.x = ship.x - W }
    if ship.y < 0px { ship.y = ship.y + H }
    if ship.y > H { ship.y = ship.y - H }
    if cool > 0 { cool = cool - 1 }
    if input.key("space") {
      if cool == 0 {
        cool = 12
        let nose = 14px
        spawn Shot at (ship.x + cos(ship.a) * nose, ship.y + sin(ship.a) * nose) { r: 2px, vx: cos(ship.a) * 6px, vy: sin(ship.a) * 6px }
        audio.play("hit")
      }
    }
  }
  draw.circle(ship.x, ship.y, ship.r, "#f4efe6")
  draw.line(ship.x, ship.y, ship.x + cos(ship.a) * 14px, ship.y + sin(ship.a) * 14px, "#f2c14e")
  each rock in Rock where true {
    rock.x = rock.x + rock.vx
    rock.y = rock.y + rock.vy
    if rock.x < 0px { rock.x = rock.x + W }
    if rock.x > W { rock.x = rock.x - W }
    if rock.y < 0px { rock.y = rock.y + H }
    if rock.y > H { rock.y = rock.y - H }
    draw.circle(rock.x, rock.y, rock.r, "#8ecae6")
  }
  each shot in Shot where true {
    shot.x = shot.x + shot.vx
    shot.y = shot.y + shot.vy
    if shot.x < 0px or shot.x > W or shot.y < 0px or shot.y > H {
      despawn shot
    } else {
      draw.circle(shot.x, shot.y, shot.r, "#f2c14e")
    }
  }
  draw.text(8px, 22px, "{score}", "#f4efe6")
}
when shot in Shot touches rock in Rock {
  despawn shot
  despawn rock
  score = score + 1
  audio.play("boom")
}
when s in Ship touches rock in Rock {
  if alive {
    alive = false
    audio.play("boom")
  }
}
`,
  },
  {
    name: 'Flappy',
    code: `# Flappy. Space flaps.
use draw
use audio
let W = 360px
let H = 240px
entity Bird { r, vy }
entity Pipe { w, h, gate }
let bird = spawn Bird at (64px, 120px) { r: 8px, vy: 0px/s }
let score = 0
let timer = 0
let alive = true
on key "space" {
  if alive { bird.vy = -150px/s }
}
on tick(dt) {
  draw.background("#87ceeb")
  if alive {
    bird.vy = bird.vy + 520px / 1s / 1s * dt
    bird.y = bird.y + bird.vy * dt
    if bird.y < bird.r { bird.y = bird.r
      bird.vy = 0px/s
    }
    if bird.y > H - bird.r { alive = false }
    timer = timer + 1
    if timer > 100 {
      timer = 0
      let top = 48px + random() * 90px
      let gap = 76px
      let bottom = H - top - gap
      spawn Pipe at (W + 40px, top / 2) { w: 36px, h: top, gate: 1 }
      spawn Pipe at (W + 40px, top + gap + bottom / 2) { w: 36px, h: bottom, gate: 0 }
    }
  }
  each pipe in Pipe where true {
    if alive { pipe.x = pipe.x - 110px/s * dt }
    if pipe.gate == 1 {
      if pipe.x < bird.x {
        pipe.gate = 2
        score = score + 1
        audio.play("score")
      }
    }
    if pipe.x < -40px { despawn pipe } else {
      draw.rect(pipe.x - pipe.w / 2, pipe.y - pipe.h / 2, pipe.w, pipe.h, "#2a9d4a")
    }
  }
  draw.circle(bird.x, bird.y, bird.r, "#f2c14e")
  draw.text(8px, 22px, "{score}", "#102033")
  if not alive { draw.text(130px, 120px, "down", "#102033") }
}
when b in Bird touches pipe in Pipe { alive = false }
`,
  },
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
    name: 'Particles',
    code: `# Particles. Move the mouse. Click to burst.
use draw
use input
entity Mote { vx, vy, life }
on tick(dt) {
  draw.background("#10141c")
  let mouse = input.mouse()
  if input.click() {
    repeat 8 {
      spawn Mote at (mouse.x, mouse.y) { vx: random() * 90px/s - 45px/s, vy: random() * 90px/s - 45px/s, life: 1 }
    }
  }
  spawn Mote at (mouse.x, mouse.y) { vx: 0px/s, vy: 0px/s, life: 1 }
  each mote in Mote where true {
    mote.x = mote.x + mote.vx * dt
    mote.y = mote.y + mote.vy * dt
    mote.life = mote.life - dt / 1s
    if mote.life > 0 {
      draw.circle(mote.x, mote.y, 2px, "#7ee0c6")
    }
    if mote.life <= 0 { despawn mote }
  }
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
