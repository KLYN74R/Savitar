
<div align="center">

<!-- [![Typing SVG](https://readme-typing-svg.herokuapp.com?font=Major+Mono+Display&size=64&color=C20000&center=true&vCenter=true&height=100&lines=Klyntar)](https://git.io/typing-svg) -->
[![Typing SVG](https://readme-typing-svg.herokuapp.com?font=Major+Mono+Display&size=100&color=0c288a&center=true&vCenter=true&width=500&height=200&lines=sAVitAR)](https://git.io/typing-svg)

# <b>A super useful tool to grab finalization proofs & get latest state as fast as possible</b>


<img src="./main.jpg">

</div>

## <b>Intro</b>

Savitar is used by <code>dev_tachyon</code> workflow to make a pro-active calls and get the <code>SUPER_FINALIZATION_PROOFS</code> after getting <code>commitments</code> and <code>finalization proofs</code>. This tool will be mutable, configurable and with maximum orientation on paralelization.

## <b>Who can use it</b>

It's a must have tool for wallets, explorers, etc. to understand the status of block and state changes
## <b>How it works</b>

Savitar requires working KLY node to make queries to. Look at configs


```json

{
    "SYMBIOTE_ID":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "NODE":"http://localhost:7331",

    "PASSIVE":false,
    "PROACTIVE_SETTING":{},
    
    "SERVER_CONFIGS":{
        "INTERFACE":"::",
        "PORT":9393
    },

    "STUFF_DEALER":"http://localhost:7331",
    "CHECKPOINT_TRACKER_TIMEOUT":5000

}

```

You should define appropriate <code>SYMBIOTE_ID</code>(analogy for <code>chainId</code> in EVM-compatible chains) to work on appropriate symbiote(chain). Then, using <code>NODE</code> value, Savitar grabs the latest checkpoint and based on <code>SUBCHAINS_METADATA</code> starts to find blocks for approprate subchains and grab commitments and finalization proofs. Savitar has proactive mode, that's why it initiates a separate thread for each subchain to get the <code>SUPER_FINALIZATION_PROOF</code>

There is a screenshot of working node(N1 in local testnet with 4 nodes and 2 quorum members(pools)) and normal Savitar workflow(on the right)

<img src="./savitar_work.png">


## <b>API</b>

For wallets and explorers Savitar proposes simple API (coming soon)


## <b>Improvements</b>

Definitely it's initial solution and simplest proposed software for lightning fast finalization. In 2 files we insert apppropiate minimal logic. You can write your own realizations using Rust, C++ and so on. Moreover, soon it will be possible to build <b><i>KLY infrastructure</i></b> and using deep configs tree on workflows - create super-parallel solutions, scale, use <code>spooky action</code> and so on.