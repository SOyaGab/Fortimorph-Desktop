# 🚀 GitHub Guide for Vibe Coders (Super Simple!)

Your GitHub Repository: **https://github.com/SOyaGab/Fortimorph-Desktop**

---

## 📚 Table of Contents
1. [What is GitHub?](#what-is-github)
2. [Saving Your Code (Push)](#saving-your-code-push)
3. [Getting Your Code on Another Computer (Clone)](#getting-your-code-on-another-computer-clone)
4. [Working with Branches](#working-with-branches)
5. [Common Commands Cheat Sheet](#common-commands-cheat-sheet)
6. [Quick Troubleshooting](#quick-troubleshooting)

---

## 🤔 What is GitHub?

Think of GitHub like **Google Drive for code**:
- It backs up your code online
- You can access it from anywhere
- You can see what changed and when
- You can work with others

---

## 💾 Saving Your Code (Push)

### Step 1: Check what changed
```powershell
cd "C:\Users\Grecil\OneDrive\Desktop\ARLENE ANO NA\fortimorph-desktop"
git status
```
This shows you what files you changed.

### Step 2: Add all changes
```powershell
git add .
```
The dot (`.`) means "add everything I changed"

### Step 3: Save with a message
```powershell
git commit -m "Describe what you changed here"
```
**Examples of good messages:**
- `"Fixed battery tracking bug"`
- `"Added new backup feature"`
- `"Updated UI colors"`

### Step 4: Upload to GitHub
```powershell
git push origin master
```

### 🎯 Quick Save (All in One)
```powershell
cd "C:\Users\Grecil\OneDrive\Desktop\ARLENE ANO NA\fortimorph-desktop"
git add .
git commit -m "Your message here"
git push origin master
```

---

## 📥 Getting Your Code on Another Computer (Clone)

### First Time Setup on a New Computer

1. **Install Git** (if not installed)
   - Download from: https://git-scm.com/download/win
   - Just click "Next" on everything

2. **Open PowerShell or Command Prompt**
   - Press `Windows + R`
   - Type `powershell` and press Enter

3. **Go to where you want the code**
   ```powershell
   cd C:\Users\YourUsername\Desktop
   ```

4. **Clone (Download) your code**
   ```powershell
   git clone https://github.com/SOyaGab/Fortimorph-Desktop.git
   ```

5. **Enter the folder**
   ```powershell
   cd Fortimorph-Desktop
   ```

6. **Install dependencies**
   ```powershell
   npm install
   ```

7. **Run the app**
   ```powershell
   npm run dev
   ```

### 🎉 That's it! Your code is now on the new computer!

---

## 🌿 Working with Branches

Branches are like **parallel versions** of your code. Think of them as "save files" in a video game.

### Why use branches?
- Try new features without breaking your working code
- Work on multiple things at once
- Keep your main code safe

### Creating a New Branch
```powershell
git checkout -b feature-name
```
**Example:**
```powershell
git checkout -b add-dark-mode
```

### See all branches
```powershell
git branch
```
The one with `*` is your current branch.

### Switch to a different branch
```powershell
git checkout branch-name
```
**Examples:**
```powershell
git checkout master          # Go back to main code
git checkout add-dark-mode   # Switch to your feature branch
```

### Merge a branch into master
```powershell
git checkout master          # Switch to master first
git merge feature-name       # Merge your feature into master
git push origin master       # Upload the merged code
```

### Delete a branch (after merging)
```powershell
git branch -d feature-name
```

---

## 📝 Common Commands Cheat Sheet

| What You Want | Command |
|---------------|---------|
| Check what changed | `git status` |
| Save all changes | `git add .` |
| Commit with message | `git commit -m "message"` |
| Upload to GitHub | `git push origin master` |
| Download latest code | `git pull origin master` |
| Clone repository | `git clone https://github.com/SOyaGab/Fortimorph-Desktop.git` |
| Create new branch | `git checkout -b branch-name` |
| Switch branches | `git checkout branch-name` |
| See all branches | `git branch` |
| See commit history | `git log --oneline` |

---

## 🔄 Daily Workflow

### Morning (Start Coding)
```powershell
cd "C:\Users\Grecil\OneDrive\Desktop\ARLENE ANO NA\fortimorph-desktop"
git pull origin master    # Get latest code
npm run dev              # Start coding
```

### During Coding (Save Often!)
```powershell
git add .
git commit -m "What I just did"
git push origin master
```

### End of Day
```powershell
git add .
git commit -m "End of day commit"
git push origin master
```

---

## 🆘 Quick Troubleshooting

### "I messed up my code, help!"
**Undo changes to a file:**
```powershell
git checkout -- filename.js
```

**Undo ALL changes (nuclear option):**
```powershell
git reset --hard
```

### "Git says I have conflicts"
This happens when the same file was changed in two places.

1. Open the file with `CONFLICT` in it
2. Look for these markers:
   ```
   <<<<<<< HEAD
   Your code
   =======
   Their code
   >>>>>>> branch-name
   ```
3. Delete the markers and keep the code you want
4. Save the file
5. Then:
   ```powershell
   git add .
   git commit -m "Fixed conflicts"
   git push origin master
   ```

### "I forgot what branch I'm on"
```powershell
git branch
```
The one with `*` is your current branch.

### "I can't push to GitHub"
Make sure you're logged in:
```powershell
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

---

## 🎓 Using Your Repo in VS Code

### Option 1: Open Existing Folder
1. Open VS Code
2. File → Open Folder
3. Select your `fortimorph-desktop` folder

### Option 2: Clone in VS Code
1. Open VS Code
2. Press `Ctrl + Shift + P`
3. Type "Git: Clone"
4. Paste: `https://github.com/SOyaGab/Fortimorph-Desktop.git`
5. Choose where to save it
6. Click "Open" when it finishes

### Using Git in VS Code
- **Source Control** icon on the left (looks like branches)
- See all changes there
- Type a message and click ✓ to commit
- Click the `...` menu → Push to upload

---

## 🌟 Pro Tips for Vibe Coders

1. **Commit often** - Small commits are better than one huge commit
   ```powershell
   # Good
   git commit -m "Fixed login button"
   git commit -m "Added logout feature"
   
   # Not as good
   git commit -m "Changed a bunch of stuff"
   ```

2. **Use branches for experiments**
   - Keep `master` branch clean and working
   - Try crazy ideas in other branches
   - Merge only when it works

3. **Pull before you push**
   ```powershell
   git pull origin master    # Get latest code
   git push origin master    # Then upload yours
   ```

4. **Write good commit messages**
   - Bad: "Fixed stuff"
   - Good: "Fixed battery percentage not updating"

5. **GitHub Desktop** (If you want a GUI)
   - Download: https://desktop.github.com/
   - No commands needed, just click buttons
   - Perfect for visual learners

---

## 🎮 Example Workflow: Adding a New Feature

```powershell
# 1. Start fresh
cd "C:\Users\Grecil\OneDrive\Desktop\ARLENE ANO NA\fortimorph-desktop"
git pull origin master

# 2. Create a feature branch
git checkout -b add-cool-feature

# 3. Code your feature...
# (Make your changes)

# 4. Save your work
git add .
git commit -m "Added cool feature"

# 5. Go back to master
git checkout master

# 6. Merge your feature
git merge add-cool-feature

# 7. Upload to GitHub
git push origin master

# 8. Delete the feature branch (optional)
git branch -d add-cool-feature
```

---

## 📱 Accessing Your Code Anywhere

Your code is at: **https://github.com/SOyaGab/Fortimorph-Desktop**

You can:
- View files in your browser
- Download as ZIP (green "Code" button → Download ZIP)
- Clone on any computer with `git clone`
- Share the link with others

---

## 🎯 Summary for Ultra-Quick Reference

**Save code to GitHub:**
```powershell
git add . && git commit -m "message" && git push origin master
```

**Get code on new computer:**
```powershell
git clone https://github.com/SOyaGab/Fortimorph-Desktop.git
cd Fortimorph-Desktop
npm install
npm run dev
```

**Try new feature safely:**
```powershell
git checkout -b new-feature    # Create branch
# ... code ...
git add . && git commit -m "Added feature"
git checkout master            # Back to main
git merge new-feature          # Merge if it works
git push origin master         # Upload
```

---

## 🤝 Need Help?

- **Forgot a command?** Check this guide!
- **Something broke?** Try `git status` to see what's happening
- **Want a GUI?** Try GitHub Desktop or VS Code's built-in Git

Remember: **You can't really break GitHub**. Your code is always backed up online! 🎉

Happy coding! 🚀
