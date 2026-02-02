#!/usr/bin/env python3
"""
Comprehensive test for all rotation strategies.

Tests the following strategies:
1. Priority - Selects first available profile from priorityOrder
2. Round-robin - Cycles through profiles using rotationIndex
3. Least-used - Selects profile with lowest usage score
4. Random - Uniformly random profile selection
5. Weighted - Weighted random selection
6. Time-based - Rotates at configured intervals
"""

import json
import os
import sys
import random
from pathlib import Path
from datetime import datetime, timezone

# Add the parent directory to the path to import core modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.auth import (
    get_profiles_file_path,
    _get_rotation_strategy_file_path,
    load_profiles_file,
    _load_rotation_strategy,
    _select_profile_by_priority,
    _select_profile_by_round_robin,
    _select_profile_by_least_used,
    _select_profile_by_random,
    _select_profile_by_weighted,
    _select_profile_by_time_based,
    get_rotating_profile_credential,
)


def setup_test_env(strategy_name: str) -> dict:
    """Setup test environment with configuration files for a specific strategy."""
    test_dir = Path(__file__).parent

    # All strategies use the same profiles
    profiles_path = test_dir / "profiles_priority.json"

    # Read rotation strategy config
    rotation_path = test_dir / f"rotation_{strategy_name.replace('-', '_')}.json"

    with open(profiles_path) as f:
        profiles_data = json.load(f)

    with open(rotation_path) as f:
        rotation_data = json.load(f)

    return {"profiles": profiles_data, "rotation": rotation_data}


def test_priority_strategy():
    """Test priority rotation strategy."""
    print("\n" + "="*70)
    print("TEST 1: Priority Strategy")
    print("="*70)

    config = setup_test_env("priority")
    profiles = config["profiles"]["profiles"]
    rotation_config = config["rotation"]
    strategy = rotation_config["strategy"]
    priority_order = strategy["priorityOrder"]

    print(f"Profiles: {len(profiles)}")
    for p in profiles:
        print(f"  - {p['id']}: {p['name']}")
    print(f"Priority order: {priority_order}")

    # Test selection
    selected = _select_profile_by_priority(profiles, priority_order)

    if selected:
        print(f"\n✓ Selected profile: {selected['id']} ({selected['name']})")
        expected = priority_order[0]
        if selected["id"] == expected:
            print(f"✓ Correctly selected first profile in priority order: {expected}")
            return True
        else:
            print(f"✗ Expected {expected}, got {selected['id']}")
            return False
    else:
        print("✗ No profile selected")
        return False


def test_round_robin_strategy():
    """Test round-robin rotation strategy."""
    print("\n" + "="*70)
    print("TEST 2: Round-Robin Strategy")
    print("="*70)

    config = setup_test_env("round_robin")
    profiles = config["profiles"]["profiles"]

    print(f"Profiles: {len(profiles)}")
    for p in profiles:
        print(f"  - {p['id']}: {p['name']}")

    # Test multiple rotations with incrementing rotationIndex
    # Function calculates: next_index = (current_index + 1) % len(profiles)
    results = []
    for i in range(5):
        # Simulate state tracking - each call increments the index
        rotation_index = i  # 0, 1, 2, 3, 4
        selected = _select_profile_by_round_robin(profiles, rotation_index)
        if selected:
            results.append(selected["id"])
            print(f"  rotationIndex={rotation_index} → {selected['id']} (index {(rotation_index + 1) % len(profiles)})")
        else:
            print(f"  rotationIndex={rotation_index} → None (unexpected!)")
            return False

    # Expected sequence: profile-2, profile-3, profile-1, profile-2, profile-3
    # rotationIndex=0 → index 1 → profile-2
    # rotationIndex=1 → index 2 → profile-3
    # rotationIndex=2 → index 0 → profile-1 (wraps)
    # rotationIndex=3 → index 1 → profile-2
    # rotationIndex=4 → index 2 → profile-3
    expected = ["profile-2", "profile-3", "profile-1", "profile-2", "profile-3"]

    if results == expected:
        print(f"✓ Round-robin sequence correct: {results}")
        return True
    else:
        print(f"✗ Expected {expected}, got {results}")
        return False


def test_least_used_strategy():
    """Test least-used rotation strategy."""
    print("\n" + "="*70)
    print("TEST 3: Least-Used Strategy")
    print("="*70)

    config = setup_test_env("least_used")
    profiles = config["profiles"]["profiles"]
    rotation_config = config["rotation"]
    strategy = rotation_config["strategy"]
    usage_data = strategy["usageData"]

    print(f"Profiles: {len(profiles)}")
    for p in profiles:
        usage = usage_data.get(p["id"], {})
        score = usage.get("requestCount", 0) + usage.get("tokenUsage", 0) / 1000
        print(f"  - {p['id']}: score={score:.0f} (req={usage.get('requestCount', 0)}, tokens={usage.get('tokenUsage', 0)})")

    # Test selection
    selected = _select_profile_by_least_used(profiles, usage_data)

    if selected:
        print(f"\n✓ Selected profile: {selected['id']} ({selected['name']})")
        # profile-3 has lowest score (10 + 5 = 15)
        expected = "profile-3"
        if selected["id"] == expected:
            print(f"✓ Correctly selected profile with lowest usage: {expected}")
            return True
        else:
            print(f"✗ Expected {expected}, got {selected['id']}")
            return False
    else:
        print("✗ No profile selected")
        return False


def test_random_strategy():
    """Test random rotation strategy."""
    print("\n" + "="*70)
    print("TEST 4: Random Strategy")
    print("="*70)

    config = setup_test_env("priority")  # Uses same profiles
    profiles = config["profiles"]["profiles"]

    print(f"Profiles: {len(profiles)}")
    for p in profiles:
        print(f"  - {p['id']}: {p['name']}")

    # Test with seed for reproducibility
    random.seed(42)
    selected = _select_profile_by_random(profiles)

    if selected:
        print(f"\n✓ Selected profile: {selected['id']} ({selected['name']})")
        print("✓ Random selection works (selection varies by seed)")

        # Test distribution
        random.seed(None)
        selections = {}
        for _ in range(1000):
            selected = _select_profile_by_random(profiles)
            if selected:
                selections[selected["id"]] = selections.get(selected["id"], 0) + 1

        print(f"\nDistribution over 1000 selections:")
        for profile_id, count in selections.items():
            percentage = (count / 1000) * 100
            print(f"  - {profile_id}: {count} ({percentage:.1f}%)")

        # Check roughly uniform (each ~33%)
        expected_percentage = 100 / len(profiles)
        all_good = True
        for profile_id, count in selections.items():
            percentage = (count / 1000) * 100
            if abs(percentage - expected_percentage) > 10:  # Allow 10% variance
                all_good = False

        if all_good:
            print("✓ Distribution is roughly uniform")
            return True
        else:
            print("✗ Distribution is not uniform")
            return False
    else:
        print("✗ No profile selected")
        return False


def test_weighted_strategy():
    """Test weighted rotation strategy."""
    print("\n" + "="*70)
    print("TEST 5: Weighted Strategy")
    print("="*70)

    config = setup_test_env("weighted")
    profiles = config["profiles"]["profiles"]
    rotation_config = config["rotation"]
    strategy = rotation_config["strategy"]
    weights = strategy["weights"]

    print(f"Profiles: {len(profiles)}")
    total_weight = sum(weights.values())
    for p in profiles:
        weight = weights.get(p["id"], 1)
        percentage = (weight / total_weight) * 100
        print(f"  - {p['id']}: weight={weight} ({percentage:.1f}%)")

    # Test with seed for reproducibility
    random.seed(42)
    selected = _select_profile_by_weighted(profiles, weights)

    if selected:
        print(f"\n✓ Selected profile: {selected['id']} ({selected['name']})")
        print("✓ Weighted selection works")

        # Test distribution
        random.seed(None)
        selections = {}
        for _ in range(1000):
            selected = _select_profile_by_weighted(profiles, weights)
            if selected:
                selections[selected["id"]] = selections.get(selected["id"], 0) + 1

        print(f"\nDistribution over 1000 selections:")
        for profile_id, count in selections.items():
            percentage = (count / 1000) * 100
            expected_percentage = (weights.get(profile_id, 1) / total_weight) * 100
            diff = abs(percentage - expected_percentage)
            print(f"  - {profile_id}: {count} ({percentage:.1f}%) expected ~{expected_percentage:.1f}% (diff={diff:.1f}%)")

        # Check distribution roughly matches weights
        all_good = True
        for profile_id, count in selections.items():
            percentage = (count / 1000) * 100
            expected_percentage = (weights.get(profile_id, 1) / total_weight) * 100
            if abs(percentage - expected_percentage) > 10:  # Allow 10% variance
                all_good = False

        if all_good:
            print("✓ Distribution roughly matches weights")
            return True
        else:
            print("✗ Distribution doesn't match weights")
            return False
    else:
        print("✗ No profile selected")
        return False


def test_time_based_strategy():
    """Test time-based rotation strategy."""
    print("\n" + "="*70)
    print("TEST 6: Time-Based Strategy")
    print("="*70)

    config = setup_test_env("time_based")
    profiles = config["profiles"]["profiles"]
    rotation_config = config["rotation"]
    strategy = rotation_config["strategy"]

    print(f"Profiles: {len(profiles)}")
    for p in profiles:
        print(f"  - {p['id']}: {p['name']}")
    print(f"Rotation interval: {strategy.get('rotationInterval', 300)}s")

    # Test 1: First rotation (no last rotation time)
    # The function sets current_index=0, then increments it to 1 for first selection
    print("\nTest 1: First rotation (no last rotation time)")
    test_config = rotation_config.copy()
    test_config["strategy"]["timeBasedLastRotationTime"] = None
    selected = _select_profile_by_time_based(profiles, test_config)
    if selected and selected["id"] == "profile-2":
        print(f"✓ First rotation selected profile-2 (index 1 after increment from 0)")
    else:
        print(f"✗ First rotation failed: expected profile-2, got {selected.get('id') if selected else 'None'}")
        return False

    # Test 2: Interval not elapsed
    print("\nTest 2: Interval not elapsed (recent rotation)")
    now = datetime.now(timezone.utc).isoformat()
    test_config = rotation_config.copy()
    test_config["strategy"]["timeBasedLastRotationTime"] = now
    test_config["strategy"]["timeBasedProfileIndex"] = 1
    selected = _select_profile_by_time_based(profiles, test_config)
    if selected and selected["id"] == "profile-2":
        print(f"✓ Interval not elapsed, using current profile-2 (index 1)")
    else:
        print(f"✗ Interval test failed: expected profile-2, got {selected.get('id') if selected else 'None'}")
        return False

    # Test 3: Interval elapsed (old rotation time)
    print("\nTest 3: Interval elapsed (old rotation time, should rotate)")
    old_time = "2024-01-01T00:00:00.000Z"
    test_config = rotation_config.copy()
    test_config["strategy"]["timeBasedLastRotationTime"] = old_time
    test_config["strategy"]["timeBasedProfileIndex"] = 1
    selected = _select_profile_by_time_based(profiles, test_config)
    # Index 1 increments to 2, so selects profile-3
    if selected and selected["id"] == "profile-3":
        print(f"✓ Interval elapsed, rotated from index 1 to 2, selected profile-3")
    else:
        print(f"✗ Rotation failed: expected profile-3, got {selected.get('id') if selected else 'None'}")
        return False

    print("✓ Time-based strategy works correctly")
    return True


def run_all_tests():
    """Run all rotation strategy tests."""
    print("\n" + "="*70)
    print("COMPREHENSIVE ROTATION STRATEGY TESTS")
    print("="*70)
    print(f"Test directory: {Path(__file__).parent / 'tests_rotation_strategies'}")
    print(f"Profiles file path: {get_profiles_file_path()}")
    print(f"Rotation file path: {_get_rotation_strategy_file_path()}")

    results = []

    # Run all tests
    tests = [
        ("Priority", test_priority_strategy),
        ("Round-Robin", test_round_robin_strategy),
        ("Least-Used", test_least_used_strategy),
        ("Random", test_random_strategy),
        ("Weighted", test_weighted_strategy),
        ("Time-Based", test_time_based_strategy),
    ]

    for name, test_func in tests:
        try:
            result = test_func()
            results.append((name, result))
        except Exception as e:
            print(f"\n✗ {name} test failed with exception: {e}")
            import traceback
            traceback.print_exc()
            results.append((name, False))

    # Summary
    print("\n" + "="*70)
    print("TEST SUMMARY")
    print("="*70)

    passed = sum(1 for _, result in results if result)
    total = len(results)

    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status}: {name}")

    print(f"\nTotal: {passed}/{total} tests passed")

    if passed == total:
        print("\n✓ All rotation strategy tests PASSED!")
        return 0
    else:
        print(f"\n✗ {total - passed} test(s) FAILED")
        return 1


if __name__ == "__main__":
    sys.exit(run_all_tests())
