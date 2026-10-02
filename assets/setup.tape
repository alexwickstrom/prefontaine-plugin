# Render with charmbracelet/vhs:  brew install vhs && vhs assets/setup.tape
Output assets/setup.gif
Require gum
Set Shell "bash"
Set FontSize 16
Set Width 1100
Set Height 820
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms

Hide
Type "export PS1='$ ' && clear"
Enter
Show

Type "bin/prefontaine-setup --dry-run"
Sleep 400ms
Enter
Sleep 1.5s

# 1/5 How bold? Move from Pinot Noir to Bold Cabernet.
Down
Sleep 600ms
Enter
Sleep 800ms

# 2/5 Doors: keep all five knocks.
Sleep 1s
Enter
Sleep 800ms

# 3/5 When idle: swirl my own glass.
Enter
Sleep 800ms

# 4/5 Cellar: in the repo.
Enter
Sleep 800ms

# 5/5 Name.
Ctrl+U
Type "Sam"
Sleep 500ms
Enter

Sleep 4s
