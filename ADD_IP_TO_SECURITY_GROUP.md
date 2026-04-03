# Add Inbound Rule to RDS Security Group

Your security group `sg-0e361f0f1b093bd83` currently only allows traffic from itself.

## Add Your IP Address

1. **In the Security Group page**, click **"Edit inbound rules"**

2. **Click "Add rule"** button

3. **Configure the new rule:**
   - **Type:** PostgreSQL (this auto-fills port 5432)
   - **Protocol:** TCP (auto-filled)
   - **Port range:** 5432 (auto-filled)
   - **Source:** Custom → Type: `165.1.155.42/32`
   - **Description:** `My development machine`

4. **Click "Save rules"**

## After Adding:

You should have 2 inbound rules:
- Rule 1: PostgreSQL from sg-0e361f0f1b093bd83 (existing)
- Rule 2: PostgreSQL from 165.1.155.42/32 (new)

## Then Test:

```bash
./test-rds-connection.sh
```

---

**Note:** The `/32` at the end means only your exact IP address, not a range.
