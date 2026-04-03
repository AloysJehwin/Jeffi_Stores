# Error: Cannot Modify Existing Rule

## The Issue
You're trying to EDIT the existing rule instead of ADDING a new rule.

## Correct Steps:

1. **Don't touch the existing rule** (the one with sg-0e361f0f1b093bd83)

2. **Click the "Add rule" button** at the bottom of the inbound rules section

3. **In the NEW empty row that appears:**
   - Type: PostgreSQL
   - Source: Custom → 165.1.155.42/32
   - Description: My dev machine

4. **Click "Save rules"**

## Result:
You should end up with TWO separate rules:

```
Rule 1: PostgreSQL | sg-0e361f0f1b093bd83 | [keep this one]
Rule 2: PostgreSQL | 165.1.155.42/32     | [new one you add]
```

**Important:** Don't modify rule 1, just ADD rule 2!
