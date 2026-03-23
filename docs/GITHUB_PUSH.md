# Push TEAM Payroll to GitHub (`robte425-code/TEAM-Payroll`)

Your machine already has:

- `git` initialized on `main`
- `origin` should use **HTTPS** so Git uses the same account as `gh` (see below).

### If push says **Permission denied to ghimsim** (or another user)

That means **`git` was using SSH** (`git@github.com:...`) while your SSH key belongs to **ghimsim**, not **robte425-code**. `gh` is logged in as **robte425-code**, but SSH ignores that.

**Fix:** use HTTPS for `origin` and wire Git to `gh`:

```bash
cd "/Users/ghim/Projects/TEAM Payroll"
git remote set-url origin https://github.com/robte425-code/TEAM-Payroll.git
gh auth setup-git
git push -u origin main
```

If `git push` says **Repository not found**, fix **both** of these:

## 1. Create the repo on GitHub (if it doesn’t exist)

Open: **https://github.com/robte425-code/TEAM-Payroll**

- If you see **404**, create it:
  - GitHub → **+** → **New repository**
  - **Owner:** `robte425-code`
  - **Name:** `TEAM-Payroll`
  - **Do not** add README / .gitignore / license (repo stays empty)
  - **Create repository**

## 2. Fix authentication on your Mac

### Option A — GitHub CLI (easiest)

```bash
gh auth login -h github.com
# Follow prompts (HTTPS or SSH). Use the account that can push to robte425-code.

git -C "/Users/ghim/Projects/TEAM Payroll" push -u origin main
```

If your `gh` token was invalid, `gh auth login` refreshes it.

### Option B — SSH

```bash
ssh -T git@github.com
# Should say: Hi <username>! ...

# That <username> must have write access to robte425-code/TEAM-Payroll.
# If needed, add your SSH public key: GitHub → Settings → SSH and GPG keys

git -C "/Users/ghim/Projects/TEAM Payroll" push -u origin main
```

### Option C — HTTPS

```bash
cd "/Users/ghim/Projects/TEAM Payroll"
git remote set-url origin https://github.com/robte425-code/TEAM-Payroll.git
git push -u origin main
# Username: your GitHub username
# Password: a Personal Access Token (classic), not your GitHub password
```

## 3. Org access

If `robte425-code` is an **organization**, your GitHub user must be a **member** with **write** access to that repository.

---

After `git push` succeeds, import the repo in Vercel (**Add project → Import** `robte425-code/TEAM-Payroll`).
