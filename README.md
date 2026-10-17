$env:TEST_SKIP_DB="1"; npx tsx --test "src/tests/*.test.ts"

Remove-Item Env:TEST_SKIP_DB
$env:FALKORDB_URL="redis://localhost:6379"
$env:FALKORDB_GRAPH="pathway"
npx tsx --test "src/tests/*.test.ts"