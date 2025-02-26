import {TreeBacked} from "@chainsafe/ssz";
import {allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/default";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {join} from "path";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {IProcessDepositTestCase} from "./type";
import {ssz} from "@chainsafe/lodestar-types";
import {expectEqualBeaconStatePhase0} from "../../../util";

describeDirectorySpecTest<IProcessDepositTestCase, phase0.BeaconState>(
  "process deposit mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/operations/deposit/pyspec_tests"),
  (testcase) => {
    const wrappedState = allForks.createCachedBeaconState<phase0.BeaconState>(
      config,
      testcase.pre as TreeBacked<phase0.BeaconState>
    );
    phase0.processDeposit(wrappedState, testcase.deposit);
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
      deposit: ssz.phase0.Deposit,
    },
    timeout: 100000000,
    shouldError: (testCase) => !testCase.post,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expectEqualBeaconStatePhase0(expected, actual);
    },
  }
);
