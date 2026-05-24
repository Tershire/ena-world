---
title: Summary
description: summary of attitude representations.
date: 2026-05-24
tags:
  - attitude
  - representation
public: true
---
## {active vs. passive} rotation
[@sommerWhyHowAvoid2018]
어떤 틀의 $k=k1$ 시점의 잔상을 틀 $a$라 하고 $k=k2$ 시점의 잔상을 틀 $b$라 하자. 아울러, 틀에 고정되어 함께 회전하는 벡터 $\textbf{v}$가 있다고 하자.
- active
	- 변화 시간  $k1$ `→` $k2$ 동안, 벡터 $\textbf{v}$의 움직임을 틀 $a$를 기준으로 기술하면 벡터 $\textbf{v}$가 회전하며, $R_{b/a}$로 표현할 수 있다. 
- passive
	- 변화 시간  $k1$ `→` $k2$ 동안, 벡터 $\textbf{v}$의 움직임을 벡터 $\textbf{v}$를 기준으로 기술하면 틀이 회전하며, $C_{ba}$로 표현할 수 있다. 

| 구분      | 설명                                | 다른 표현 |
| ------- | --------------------------------- | ----- |
| active  | source 틀 관점에서 기술한, 틀에 고정된 벡터의 움직임 | alibi |
| passive | 틀에 고정된 벡터 관점에서 기술한, 틀의 움직임        | alias |

passive 회전을 다음과 같이 한 번 더 구분할 수 있다.

| 약자   | 풀이             | 설명                   | 기호       |
| ---- | -------------- | -------------------- | -------- |
| PATB | passive a-to-b | 회전 {전 `→` 후} 움직임을 기술 | $C_{ba}$ |
| PBTA | passive b-to-a | 회전 {후 `→` 전} 움직임을 기술 | $C_{ab}$ |
- [@sommerWhyHowAvoid2018]은 $a$와 $b$를 각각 world, body라 표현한다.
- [@solaQuaternionKinematicsErrorstate2017]은 이 구분을 function이라 지칭하고, $a$와 $b$를 각각 global, local이라 표현한다.


$C_{ba} = R^T_{b/a}$

즉,

${}_{b}\mathbf{v} = C_{ba} \; {}_{a}\mathbf{v} = R^T_{b/a} \; {}_{a}\mathbf{v}$


## 항법 분야에의 적용






