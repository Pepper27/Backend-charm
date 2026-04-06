const Order = require("../../models/order.model");
const Product = require("../../models/product.model");
module.exports.updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ message: "Đơn hàng không tồn tại" });
    }
    req.body.updatedBy = req.account.id;
    await Order.updateOne({
        _id: id
    }, req.body);

    if(req.body.status==="delivered"&&order.checkStatus===false){
      for (const item of order.cart) {
        await Product.updateOne({
            "variants._id":item.variantId,
        },{
            $inc:{
                "variants.$.sold": +item.quantity
            }
        })
      }
      await Order.updateOne({ _id:id},{
        checkStatus:true
      })
    }
    return res.status(200).json({
      message: "Cập nhật đơn hàng thành công",
      data: order
    });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
        message: "Lỗi khi cập nhật đơn hàng",
        error: error.message
        });
    }
};