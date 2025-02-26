import {join} from "path";

import {TreeBacked} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/default";
import {allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IStateTestCase} from "../../../../utils/specTestTypes/stateTestCase";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {ssz} from "@chainsafe/lodestar-types";
import {expectEqualBeaconStatePhase0} from "../../../util";

describeDirectorySpecTest<IStateTestCase, phase0.BeaconState>(
  "epoch slashings mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/epoch_processing/slashings/pyspec_tests"),
  (testcase) => {
    const wrappedState = allForks.createCachedBeaconState<phase0.BeaconState>(
      config,
      testcase.pre as TreeBacked<phase0.BeaconState>
    );
    const epochProcess = allForks.beforeProcessEpoch(wrappedState);
    phase0.processSlashings(wrappedState, epochProcess);
    return wrappedState;
  },
  {
    inputTypes: {
      pre: {
        type: InputType.SSZ_SNAPPY,
        treeBacked: true,
      },
      post: {
        type: InputType.SSZ_SNAPPY,
        treeBacked: true,
      },
    },
    sszTypes: {
      pre: ssz.phase0.BeaconState,
      post: ssz.phase0.BeaconState,
    },
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expectEqualBeaconStatePhase0(expected, actual);
    },
  }
);
