# Render with charmbracelet/vhs:  brew install vhs && vhs assets/setup.tape
# Writes setup.gif plus two 2x PNG stills for the README. --dry-run: nothing touches your config.
Output assets/setup.gif
Require gum
Set Shell "bash"
Set FontFamily "JetBrainsMono Nerd Font"
Set FontSize 24
Set Width 1800
Set Height 1400
Set Padding 48
Set LineHeight 1.25
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set BorderRadius 14
Set Margin 36
Set MarginFill "#1B1F2A"
Set TypingSpeed 55ms

Hide
Type "export PS1='$ ' && clear"
Enter
Show

Type "bin/prefontaine-setup --dry-run"
Sleep 400ms
Enter
Sleep 4s

# 1/5 Autonomy: keep the default.
Sleep 1.2s
Screenshot assets/setup-quiz.png
Enter
Sleep 2s

# 2/5 Doors: keep all five.
Sleep 1s
Enter
Sleep 2s

# 3/5 Done early: review its own diff.
Enter
Sleep 2s

# 4/5 Decision log: in the repo.
Enter
Sleep 2s

# 5/5 Name.
Ctrl+U
Type "Sam"
Sleep 500ms
Enter

Sleep 3s
# gum's late terminal-query replies land on the prompt; clear them off-camera.
Hide
Ctrl+U
Show
Sleep 300ms
Screenshot assets/setup-card.png
Sleep 2s
