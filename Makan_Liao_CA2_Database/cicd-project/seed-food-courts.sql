INSERT INTO makan_liao.food_courts (code, name, updated_at)
SELECT 'FC' || number, 'Food Court ' || number, now()
FROM generate_series(1, 6) AS number
WHERE current_database() = 'makan_liao_ca2_dev'
ON CONFLICT (code) DO NOTHING;
