import {join} from "path";

import {TreeBacked} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/default";
import {allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessSlotsTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {BeaconState} from "@chainsafe/lodestar-types/phase0";
import {ssz} from "@chainsafe/lodestar-types";
import {expectEqualBeaconStatePhase0} from "../../../util";

describeDirectorySpecTest<IProcessSlotsTestCase, phase0.BeaconState>(
  "slot sanity mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/sanity/slots/pyspec_tests"),
  (testcase) => {
    const wrappedState = allForks.createCachedBeaconState<phase0.BeaconState>(
      config,
      testcase.pre as TreeBacked<phase0.BeaconState>
    );
    const postState = allForks.processSlots(
      wrappedState as allForks.CachedBeaconState<allForks.BeaconState>,
      wrappedState.slot + Number(testcase.slots)
    );
    return postState.type.createTreeBacked(postState.tree) as phase0.BeaconState;
  },
  {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    inputTypes: {
      pre: {
        type: InputType.SSZ_SNAPPY,
        treeBacked: true,
      },
      post: {
        type: InputType.SSZ_SNAPPY,
        treeBacked: true,
      },
      slots: InputType.YAML,
    },
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    sszTypes: {
      pre: ssz.phase0.BeaconState,
      post: ssz.phase0.BeaconState,
    },
    shouldError: (testCase) => {
      return !testCase.post;
    },
    timeout: 10000000,
    getExpected: (testCase) => testCase.post as BeaconState,
    expectFunc: (testCase, expected, actual) => {
      expectEqualBeaconStatePhase0(expected, actual);
    },
  }
);
