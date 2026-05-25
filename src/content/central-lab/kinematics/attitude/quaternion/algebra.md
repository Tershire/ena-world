---
title: Algebra
description: quaternion algebra
date: 2026-05-25
tags:
  - attitude
  - representation
  - operations
public: true
---
# definition
$q=(q_{w},\; \textbf{q}) = (q_{w},\; q_{x},\; q_{y},\; q_{z})$

or

$q=(q_{0},\; \textbf{q}) = (q_{0},\; q_{1},\; q_{2},\; q_{3})$
# operations

## addition ($+$)
두 쿼터니언 $a$, $b$에 대해 다음이 성립한다.
<!-- left -->
$$
a + b = \begin{pmatrix}
a_{0} + b_{0} \\ 
\textbf{a} + \textbf{b}
\end{pmatrix}
$$
## multiplication ($⊙$)
Hamilton이 정의한 곱셈은 다음과 같다.

$$
a ⊙ b = \begin{pmatrix}
a_{0} \; b_{0} - \textbf{a} \cdot \textbf{b} \\ 
a_{0} \; \textbf{b} + b_{0} \; \textbf{a} + \textbf{a} \times \textbf{b}
\end{pmatrix}
$$
### properties

$i ⊙ j ⊙ k = −1$ (right-handed)




