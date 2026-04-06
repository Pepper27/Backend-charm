const Role = require("../../models/role.model")
module.exports.getRoles = async (req,res) =>{

        console.log(122)
        const roleList = await Role.find({
            deleted:false
        })
        res.status(200).json({
            data: roleList
        })

}
module.exports.getRolesById = async (req,res) =>{
      try {
        const id = req.params.id
        const role = await Role.findOne({
            _id:id,
            deleted:false
        })
        if(!role){
            res.status(404).json({
                message:"Không tìm thấy quyền này!"
            })
        }
        res.status(200).json({
            data: role
        })
    }catch (error) {
        res.status(500).json({
            message: "Lỗi server",
            error: error.message
        })
    }
}
module.exports.roleCreate = async (req,res) =>{
    req.body.createdBy = req.account.id
    req.body.updatedBy = req.account.id
    const dataFinal = new Role(req.body)
    await dataFinal.save()
    req.flash("success","Tạo mới nhóm quyền thành công!")
    res.json({
        code:"success"
    })
}

module.exports.roleUpdate = async (req,res)=>{
    try {
        const id = req.params.id
        req.body.updatedBy = req.account.id
        await Role.updateOne({
            _id:id,
            deleted:false
        },req.body)
        req.flash("success","Cập nhật thành công!")
        res.json({
            code:"success"
        })
    } catch (error) {
        res.json({
            code:"error",
            message:"Cập nhật thất bại!"
        })
    }
}

module.exports.roleDelete = async (req,res)=>{
    try {
        const id = req.params.id
        req.body.updatedBy = req.account.id
        await Role.updateOne({
            _id:id,
        },{
            deleted:true, 
            deletedAt:Date.now(),
            deletedBy:req.account.id
        })
        req.flash("success","Xóa thành công!")
        res.json({
            code:"success"
        })
    } catch (error) {
        res.json({
            code:"error",
            message:"Xóa thất bại!"
        })
    }
}

